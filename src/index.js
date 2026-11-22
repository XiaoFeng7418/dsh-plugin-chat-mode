/**
 * dsh-plugin-chat-mode — a minimal, tool-free chat preset host plugin.
 *
 * The preset row in `cordis.patch.yml` decides what the agent *has*: no tool
 * rows and no workflow rows. This plugin decides what the request *looks like*:
 *
 * 1. one complete system-prompt section (so nothing inherited leaks in), whose
 *    text follows the session's tone; runtime context stays suppressed;
 * 2. no tools at all — inherited global tools from other plugins are restricted
 *    away for this agent, because a preset cannot unregister them. The two web
 *    tools are registered here and only appear after `/web on`;
 * 3. a temperature for non-thinking turns only — thinking requests keep the
 *    provider default because the provider rejects a conflicting temperature;
 * 4. local slash commands (`/chat`, `/tone`, `/temp`, `/web`) that cost zero
 *    tokens, plus per-session usage accumulation for `/chat savings`.
 *
 * @module dsh-plugin-chat-mode
 */

import { appendFileSync } from 'node:fs'
import { configFilePath, isDeepSeekProvider, loadOptions, shouldSendTemperature } from './options.js'
import { promptForTone } from './prompts.js'
import { addUsage, INSTANCE_ID, resolveTemperature, stateOf } from './session.js'
import { registerChatCommands } from './commands.js'
import { CHAT_TOOL_NAMES, webToolDefinitions } from './webtools.js'

/** Cordis plugin name. */
export const name = 'chat-mode'

/** Wait for every service this plugin touches before registering anything. */
export const inject = ['systemPrompt', 'tools', 'commands', 'web']

/** Unique section name; duplicates inside one scope are rejected by the host. */
const SECTION_NAME = 'chat-mode:prompt'

/**
 * @param {any} ctx Preset-scoped Cordis context.
 * @param {Record<string, unknown>} [config] Row config from `cordis.patch.yml`.
 */
export function apply(ctx, config = {}) {
  // The browser half is discovered from an *active Loader row* whose package
  // declares `dsh.client`. The root row in `cordis.patch.yml` exists only to
  // publish `client.js`; it must not build a second chat agent.
  if (config.clientOnly === true) return
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(`chat-mode: ${message}`)
    } catch {
      /* logging must never break a chat */
    }
  }
  const options = loadOptions(config, { warn })
  const traceFile = options.traceFile
  const trace = traceFile === null ? undefined : (/** @type {Record<string, unknown>} */ line) => writeTrace(traceFile, line, warn)
  const stateFor = (/** @type {any} */ agent) => stateOf(agent, options)

  // Blank-session preset changes reuse the Agent scope. Own each mask so it
  // can be replaced (restrictions intersect) and removed when leaving Chat.
  /** @type {Map<any, () => void>} */
  const agentMasks = new Map()
  const releaseMask = (/** @type {any} */ agent) => {
    agentMasks.get(agent)?.()
    agentMasks.delete(agent)
  }
  const replaceMask = (/** @type {any} */ agent) => {
    releaseMask(agent)
    const dispose = stripTools(agent, warn, trace, stateFor)
    if (typeof dispose === 'function') agentMasks.set(agent, dispose)
  }
  ctx.effect(() => () => {
    for (const agent of agentMasks.keys()) releaseMask(agent)
  }, 'chat-mode.agent-masks')
  ctx.on('agent-preset/selected', (sessionId, preset) => {
    if (preset === 'chat') return
    for (const agent of agentMasks.keys()) {
      if (agent?.session?.id === sessionId) releaseMask(agent)
    }
  })
  ctx.on('agent/disposed', ({ agent }) => { releaseMask(agent) })

  trace?.({
    via: 'apply',
    promptMode: options.promptMode,
    temperature: options.temperature,
    defaultThinking: options.defaultThinking,
    webSearch: options.webSearch,
    webSearchProvider: options.webSearchProvider,
  })

  // A complete section becomes the only section in the assembly, which drops
  // the harness identity and every engineering/workflow prompt. Its text is a
  // function of the *calling agent*, so /tone changes one session only, and the
  // runtime-context suppressor removes OS, git, cwd and file-tree facts.
  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: 0,
    text: (/** @type {any} */ context) => {
      const state = stateFor(context?.agent)
      trace?.({
        via: 'prompt:render',
        instance: INSTANCE_ID,
        keys: context === undefined ? [] : Object.keys(context),
        sessionId: context?.agent?.session?.id ?? null,
        tone: state.tone,
        chars: promptForTone(state).length,
      })
      return promptForTone(state)
    },
    complete: true,
  }), 'chat-mode.prompt')
  ctx.effect(() => ctx.systemPrompt.suppressRuntimeContext(), 'chat-mode.runtime-context')

  // The two web tools are registered first: the scope-wide mask below keeps
  // only these names, so the allow list must already see them. `when` hides
  // them from declarations *and* dispatch unless the session turned web access
  // on, which keeps the default request free of any `tools` field.
  try {
    for (const definition of webToolDefinitions(webRuntime(ctx, options), {})) {
      ctx.tools.register(definition, { when: ({ agent }) => {
        const enabled = stateFor(agent).web
        trace?.({ via: 'tools:when', instance: INSTANCE_ID, sessionId: agent?.session?.id ?? null, tool: definition.name, enabled })
        return enabled
      } })
    }
  } catch (error) {
    warn(`could not register web tools: ${error instanceof Error ? error.message : String(error)}`)
  }

  // A preset cannot unregister another plugin's global tools, so the scope is
  // restricted to the two names above. An allow list is name-independent: a
  // tool that a newer harness build adds later stays out without a plugin
  // update, which a deny list of today's names would not guarantee.
  maskGlobalTools(ctx, warn, trace)

  registerChatCommands(ctx, {
    options,
    warn,
    trace,
    savePath: configFilePath(),
    stateOf: stateFor,
  })

  ctx.on('agent/created', (payload) => {
    replaceMask(payload?.agent)
  })

  // Keep masking on later steps too: a plugin that registers a tool lazily
  // must not smuggle it into an existing chat. The listener must hand the
  // step decision through: a waterfall listener that returns nothing would
  // replace the prepared step with `undefined`.
  ctx.on('agent/pre-step', (payload, next) => {
    replaceMask(payload.agent)
    return next()
  })

  // `agent/inbox/claimed` runs inside `inbox.claim()` before the step captures
  // its model selection, so the thinking default reaches the very first request
  // on runtimes that dispatch it (0.2.2-rc.3). On 0.2.2-rc.1 the event is not
  // dispatched; the pre-step fallback below then covers later turns instead.
  ctx.on('agent/inbox/claimed', (payload) => {
    replaceMask(payload?.agent)
    if (options.defaultThinking === 'off') defaultToNonThinking(payload?.agent, payload?.turn, warn, trace)
  })

  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const agent = payload?.agent
    const state = agent === undefined ? undefined : stateFor(agent)
    const temperature = state === undefined ? null : resolveTemperature(state, options)
    const effort = agent?.model?.current?.()?.reasoningEffort
    // `/temp` is a live, per-session choice. It must win over the value the
    // harness persisted in the request header after the first request
    // (`spent`), so it takes a different branch than the row/file default.
    const locked = state !== undefined && state.temperature !== 'auto'
    const canSend = effort === 'off' && temperature !== null
    const traceLine = {
      via: 'agent/request',
      provider: resolved.provider,
      model: resolved.model,
      reasoningEffort: resolved.reasoningEffort ?? null,
      maxTokens: resolved.maxTokens ?? null,
    }
    if (locked) {
      trace?.({ ...traceLine, temperature: canSend ? temperature : null, locked: true })
      if (canSend) return { ...resolved, temperature }
      const { temperature: _dropped, ...rest } = resolved
      return rest
    }
    const accept = shouldSendTemperature(effort, temperature, resolved.temperature)
    trace?.({ ...traceLine, temperature: accept ? temperature : resolved.temperature ?? null })
    if (!accept) {
      // Thinking requests must never carry a temperature. The harness persists
      // the first request's temperature in the session header, so even the
      // default (auto) path has to strip it once thinking is on.
      if (effort !== 'off') {
        const { temperature: _dropped, ...rest } = resolved
        return rest
      }
      return resolved
    }
    return { ...resolved, temperature }
  })

  // Provider-reported usage per session powers `/chat savings`. The waterfall
  // wants a synchronous handler that returns the stream, so the wrapper is an
  // async generator, not an `async` function.
  ctx.on('llm/stream', (payload, next) => {
    const stream = next()
    const sessionId = payload?.sessionId
    return (async function* () {
      for await (const chunk of stream) {
        if (chunk?.type === 'usage' && chunk.usage !== undefined) {
          addUsage(sessionId, chunk.usage)
          trace?.({ via: 'llm/usage', input: chunk.usage.inputTokens ?? 0, output: chunk.usage.outputTokens ?? 0 })
        }
        yield chunk
      }
    })()
  })
}

/**
 * The `web` service whose providers the two chat tools use. The preset mounts
 * an isolated `web` runtime pinned to `deepseek-official`, so the shim keeps
 * the user's global Web settings untouched. `webSearchProvider: 'inherit'` is
 * the escape hatch for people who deliberately configured their own provider:
 * it walks to the root context and uses the global runtime instead.
 *
 * @param {any} ctx Preset-scoped Cordis context.
 * @param {{ webSearchProvider: 'deepseek-official' | 'inherit' }} options
 * @returns {any}
 */
function webRuntime(ctx, options) {
  if (options.webSearchProvider !== 'inherit') return ctx.web
  try {
    const root = ctx.root
    const inherited = root?.get?.('web')
    return inherited ?? ctx.web
  } catch {
    return ctx.web
  }
}
/**
 * Start a new DeepSeek chat without thinking, but only on the first turn and
 * only while the session has not recorded a reasoning level. The harness seeds
 * a fresh session with the adapter default (`high`) before the UI shows any
 * choice, so "no recorded level" is the signal that nothing was chosen yet.
 *
 * @param {any} agent Agent created under this preset.
 * @param {number | undefined} turn Turn that claimed the message.
 * @param {(message: string) => void} warn
 * @param {((line: Record<string, unknown>) => void) | undefined} trace
 */
function defaultToNonThinking(agent, turn, warn, trace) {
  try {
    const current = agent?.model?.current?.()
    const applied = turn === 1
      && current !== undefined
      && current.reasoningEffort === undefined
      && isDeepSeekProvider(current.provider)
      && typeof current.model === 'string'
    trace?.({ via: 'agent/inbox/claimed', turn: turn ?? null, current: current ?? null, applied })
    if (!applied) return
    agent.model.select({ provider: current.provider, model: current.model, reasoningEffort: 'off' })
  } catch (error) {
    warn(`could not default the reasoning effort: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Mask every globally registered tool for the whole preset scope.
 *
 * A preset cannot unregister another plugin's rows, and those tools are
 * registered globally, so the preset's own scope is where they can be hidden:
 * every agent under it inherits the restriction, and the first request is
 * already covered.
 *
 * @param {any} ctx Preset-scoped Cordis context.
 * @param {(message: string) => void} warn
 * @param {((line: Record<string, unknown>) => void) | undefined} trace
 */
function maskGlobalTools(ctx, warn, trace) {
  try {
    const tools = ctx?.tools
    if (tools === undefined) {
      trace?.({ via: 'maskGlobalTools:no-service' })
      return
    }
    applyScopeRestriction(tools, 'maskGlobalTools', warn, trace, [...CHAT_TOOL_NAMES], false)
  } catch (error) {
    trace?.({ via: 'maskGlobalTools:error', message: error instanceof Error ? error.message : String(error) })
    warn(`could not mask global tools: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Restrict one tool scope to the two names this plugin owns.
 *
 * Older engines (0.2.1 and the DSH Go builds) expose `tools.restrict` but no
 * `tools.definitions`, so the restriction cannot be derived from the current
 * tool list there. The order below keeps every engine covered:
 *
 * 1. allow only the two chat tools — correct when they are global rows, which
 *    is how this plugin registers them, and name-independent for everything a
 *    later build adds;
 * 2. allow nothing at all — used when the two names are not global in this
 *    composition (they are registered per agent instead);
 * 3. deny whatever is currently listed, which needs `definitions`.
 *
 * The allow list is the one lever every supported engine honours: 0.2.1 has no
 * `when` option on `register` (tools are registered unconditionally there) and
 * no `tools.definitions`, so the per-request scope restriction is what keeps a
 * web-off session tool-free.
 *
 * The empty fallback only belongs to a caller that derives its allow list from
 * the live scope. A preset that allows nothing would filter out the two tools
 * this plugin registered there, because every layer on the chain has to admit a
 * name for the agent to see it.
 *
 * @param {any} tools Tool service from a preset or agent scope.
 * @param {string} via Trace tag of the calling helper.
 * @param {(message: string) => void} warn
 * @param {((line: Record<string, unknown>) => void) | undefined} trace
 * @param {readonly string[]} allow Tool names this scope may keep.
 * @param {boolean} allowEmptyFallback Whether an empty allow list may replace a failed allow-own.
 */
function applyScopeRestriction(tools, via, warn, trace, allow, allowEmptyFallback) {
  try {
    const dispose = tools.restrict({ allow: [...allow] })
    trace?.({ via, mode: 'allow-own', allow: [...allow] })
    return dispose
  } catch (error) {
    trace?.({ via: `${via}:allow-own-failed`, message: error instanceof Error ? error.message : String(error) })
  }
  if (!allowEmptyFallback || allow.length === 0) return
  try {
    const dispose = tools.restrict({ allow: [] })
    trace?.({ via, mode: 'allow-none' })
    return dispose
  } catch (error) {
    trace?.({ via: `${via}:allow-none-failed`, message: error instanceof Error ? error.message : String(error) })
  }
  let known = []
  try {
    known = tools.definitions().map((/** @type {any} */ definition) => definition.name)
  } catch (error) {
    trace?.({ via: `${via}:definitions-failed`, message: error instanceof Error ? error.message : String(error) })
    warn('could not list tools to mask; this engine needs an allow-list restriction')
    return
  }
  const deny = known.filter((name) => !CHAT_TOOL_NAMES.has(name))
  trace?.({ via, mode: 'deny-rest', known: known.length, deny })
  if (deny.length === 0) return
  try {
    return tools.restrict({ deny })
  } catch {
    /** @type {Array<() => void>} */
    const disposers = []
    for (const name of deny) {
      try {
        disposers.push(tools.restrict({ deny: [name] }))
      } catch {
        warn(`could not restrict tool "${name}"`)
      }
    }
    return () => { for (const dispose of disposers) dispose() }
  }
}

/**
 * Mask every tool this agent currently inherits from the global tool set.
 *
 * `tools.restrict` needs an agent scope and only affects inherited global
 * registrations, which is exactly the leak: rows in other plugins and bundles
 * register tools globally, and no preset list can remove them.
 *
 * @param {any} agent Agent created under this preset.
 * @param {(message: string) => void} warn
 * @param {((line: Record<string, unknown>) => void) | undefined} trace
 * @param {(agent: any) => { web: boolean }} stateOf Session state for this agent.
 */
function stripTools(agent, warn, trace, stateOf) {
  try {
    const tools = agent?.ctx?.tools
    if (tools === undefined) {
      trace?.({ via: 'stripTools:no-service' })
      return
    }
    const allow = stateOf(agent).web ? [...CHAT_TOOL_NAMES] : []
    return applyScopeRestriction(tools, 'stripTools', warn, trace, allow, true)
  } catch (error) {
    trace?.({ via: 'stripTools:error', message: error instanceof Error ? error.message : String(error) })
    warn(`could not restrict tools: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Record one JSON line for diagnosis. Never message bodies.
 *
 * @param {string} file Absolute JSONL path.
 * @param {Record<string, unknown>} line
 * @param {(message: string) => void} warn
 */
function writeTrace(file, line, warn) {
  try {
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`, 'utf8')
  } catch (error) {
    warn(`trace write failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
