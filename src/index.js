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
import { addUsage, resolveTemperature, stateOf } from './session.js'
import { registerChatCommands } from './commands.js'
import { webToolDefinitions } from './webtools.js'

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
  trace?.({
    via: 'apply',
    promptMode: options.promptMode,
    temperature: options.temperature,
    defaultThinking: options.defaultThinking,
    webSearch: options.webSearch,
  })

  // A complete section becomes the only section in the assembly, which drops
  // the harness identity and every engineering/workflow prompt. Its text is a
  // function of the *calling agent*, so /tone changes one session only, and the
  // runtime-context suppressor removes OS, git, cwd and file-tree facts.
  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: 0,
    text: (/** @type {any} */ context) => promptForTone(stateFor(context?.agent)),
    complete: true,
  }), 'chat-mode.prompt')
  ctx.effect(() => ctx.systemPrompt.suppressRuntimeContext(), 'chat-mode.runtime-context')

  // A preset cannot unregister another plugin's global tools, so they are
  // masked for this preset's whole scope first, and again on every later step
  // for tools that a plugin registers after the preset mounted.
  maskGlobalTools(ctx, warn, trace)

  // The two web tools are scoped registrations, so the global mask above does
  // not touch them. `when` hides them from declarations *and* dispatch unless
  // the session turned web access on, which keeps the default request free of
  // any `tools` field.
  try {
    for (const definition of webToolDefinitions(ctx.web, {})) {
      ctx.tools.register(definition, { when: ({ agent }) => stateFor(agent).web })
    }
  } catch (error) {
    warn(`could not register web tools: ${error instanceof Error ? error.message : String(error)}`)
  }

  registerChatCommands(ctx, {
    options,
    warn,
    trace,
    savePath: configFilePath(),
    stateOf: stateFor,
  })

  ctx.on('agent/created', (payload) => {
    stripTools(payload?.agent, warn, trace)
  })

  // Keep masking on later steps too: a plugin that registers a tool lazily
  // must not smuggle it into an existing chat. The listener must hand the
  // step decision through: a waterfall listener that returns nothing would
  // replace the prepared step with `undefined`.
  ctx.on('agent/pre-step', (payload, next) => {
    stripTools(payload.agent, warn, trace)
    return next()
  })

  // `agent/inbox/claimed` runs inside `inbox.claim()` before the step captures
  // its model selection, so the thinking default reaches the very first request
  // on runtimes that dispatch it (0.2.2-rc.3). On 0.2.2-rc.1 the event is not
  // dispatched; the pre-step fallback below then covers later turns instead.
  ctx.on('agent/inbox/claimed', (payload) => {
    stripTools(payload?.agent, warn, trace)
    if (options.defaultThinking === 'off') defaultToNonThinking(payload?.agent, payload?.turn, warn, trace)
  })

  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const agent = payload?.agent
    const temperature = agent === undefined ? null : resolveTemperature(stateFor(agent), options)
    const effort = agent?.model?.current?.()?.reasoningEffort
    const accept = shouldSendTemperature(effort, temperature, resolved.temperature)
    trace?.({
      via: 'agent/request',
      provider: resolved.provider,
      model: resolved.model,
      reasoningEffort: resolved.reasoningEffort ?? null,
      temperature: accept ? temperature : resolved.temperature ?? null,
      maxTokens: resolved.maxTokens ?? null,
    })
    if (!accept) return resolved
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
    const names = tools.definitions().map((/** @type {any} */ definition) => definition.name)
    trace?.({ via: 'maskGlobalTools', count: names.length })
    if (names.length === 0) return
    try {
      tools.restrict({ deny: names })
    } catch {
      for (const name of names) {
        try {
          tools.restrict({ deny: [name] })
        } catch {
          warn(`could not restrict tool "${name}"`)
        }
      }
    }
  } catch (error) {
    trace?.({ via: 'maskGlobalTools:error', message: error instanceof Error ? error.message : String(error) })
    warn(`could not mask global tools: ${error instanceof Error ? error.message : String(error)}`)
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
 */
function stripTools(agent, warn, trace) {
  try {
    const tools = agent?.ctx?.tools
    if (tools === undefined) {
      trace?.({ via: 'stripTools:no-service' })
      return
    }
    const names = tools.definitions(agent).map((/** @type {any} */ definition) => definition.name)
    trace?.({ via: 'stripTools', count: names.length })
    if (names.length === 0) return
    try {
      tools.restrict({ deny: names })
    } catch (batchError) {
      trace?.({ via: 'stripTools:batch-failed', message: batchError instanceof Error ? batchError.message : String(batchError) })
      // One unusable name (for example the reserved code-mode transport) must
      // not leave every other tool visible, so fall back to one name at a time.
      for (const name of names) {
        try {
          tools.restrict({ deny: [name] })
        } catch (error) {
          trace?.({ via: 'stripTools:failed', name, message: error instanceof Error ? error.message : String(error) })
          warn(`could not restrict tool "${name}"`)
        }
      }
    }
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
