/**
 * dsh-plugin-chat-mode — a minimal, tool-free chat preset host plugin.
 *
 * The preset row in `cordis.patch.yml` decides what the agent *has*: no tool
 * rows and no workflow rows. This plugin decides what the request *looks like*:
 *
 * 1. one complete system-prompt section (so nothing inherited leaks in) and no
 *    runtime context (no OS, git or file-tree snapshot);
 * 2. no tools at all — inherited global tools from other plugins are restricted
 *    away for this agent, because a preset cannot unregister them;
 * 3. a default reasoning effort of `off` for a fresh chat, when the user has
 *    not already chosen a level and the route is a DeepSeek one;
 * 4. a temperature for non-thinking turns only — thinking requests keep the
 *    provider default because the provider rejects a conflicting temperature.
 *
 * @module dsh-plugin-chat-mode
 */

import { appendFileSync } from 'node:fs'
import { isDeepSeekProvider, loadOptions, shouldSendTemperature } from './options.js'
import { promptFor } from './prompts.js'

/** Cordis plugin name. */
export const name = 'chat-mode'

/** Wait for the prompt registry before registering the section. */
export const inject = ['systemPrompt']

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

  // A complete section becomes the only section in the assembly, which drops
  // the harness identity and every engineering/workflow prompt. The runtime
  // context suppressor additionally removes dynamic facts such as the OS,
  // git state, cwd and the file tree.
  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: 0,
    text: promptFor(options),
    complete: true,
  }), 'chat-mode.prompt')
  ctx.effect(() => ctx.systemPrompt.suppressRuntimeContext(), 'chat-mode.runtime-context')

  ctx.on('agent/created', ({ agent, source }) => {
    // A preset cannot unregister another plugin's global tools, so the agent
    // scope masks them. This runs before the first step resolves its tool set.
    stripTools(agent, warn)
    if (options.defaultThinking === 'off') defaultToNonThinking(agent, source, warn, trace)
  })

  // Keep masking on later steps too: a plugin that registers a tool lazily
  // must not smuggle it into an existing chat.
  ctx.on('agent/pre-step', ({ agent }) => stripTools(agent, warn))

  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const temperature = options.temperature
    const effort = payload?.agent?.model?.current?.()?.reasoningEffort
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
}

/**
 * Start a new DeepSeek chat without thinking. The gate is the session start
 * source rather than the recorded effort, because this harness fills a fresh
 * session with the adapter default (`high`) before the UI ever shows a choice;
 * a resumed or compacted session keeps whatever it recorded.
 *
 * @param {any} agent Agent created under this preset.
 * @param {string} source Session start source: startup, resume, clear or compact.
 * @param {(message: string) => void} warn
 * @param {((line: Record<string, unknown>) => void) | undefined} trace
 */
function defaultToNonThinking(agent, source, warn, trace) {
  try {
    const current = agent?.model?.current?.()
    const fresh = source === 'startup' || source === 'clear'
    const applied = fresh
      && current !== undefined
      && current.reasoningEffort !== 'off'
      && isDeepSeekProvider(current.provider)
      && typeof current.model === 'string'
    trace?.({ via: 'agent/created', source, current: current ?? null, applied })
    if (!applied) return
    agent.model.select({ provider: current.provider, model: current.model, reasoningEffort: 'off' })
  } catch (error) {
    warn(`could not default the reasoning effort: ${error instanceof Error ? error.message : String(error)}`)
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
 */
function stripTools(agent, warn) {
  try {
    const tools = agent?.ctx?.tools
    if (tools === undefined) return
    const names = tools.definitions(agent).map((/** @type {any} */ definition) => definition.name)
    if (names.length === 0) return
    try {
      tools.restrict({ deny: names })
    } catch {
      // One unusable name (for example the reserved code-mode transport) must
      // not leave every other tool visible, so fall back to one name at a time.
      for (const name of names) {
        try {
          tools.restrict({ deny: [name] })
        } catch {
          warn(`could not restrict tool "${name}"`)
        }
      }
    }
  } catch (error) {
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
