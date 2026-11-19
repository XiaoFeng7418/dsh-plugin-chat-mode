/**
 * Per-session chat state: tone, temperature override, web toggle and the usage
 * counter behind `/chat savings`.
 *
 * State is keyed by the agent object, so two sessions never share a tone or a
 * web switch, and a released agent is garbage-collected with its WeakMap entry.
 * Usage is keyed by session id because `llm/stream` only carries that.
 *
 * @module dsh-plugin-chat-mode/session
 */

/**
 * @typedef {'auto' | 'off' | number} TemperatureChoice
 */

/**
 * @typedef {object} ChatSessionState
 * @property {string} tone Current tone id.
 * @property {string} customPrompt Text used by the `custom` tone.
 * @property {TemperatureChoice} temperature `auto` follows the preset config.
 * @property {boolean} web Whether the two web tools are exposed.
 */

/**
 * @typedef {object} SessionUsage
 * @property {number} input
 * @property {number} output
 * @property {number} calls
 */

/** @type {WeakMap<object, ChatSessionState>} */
const STATES = new WeakMap()

/** @type {Map<string, SessionUsage>} */
const USAGE = new Map()

/**
 * Read (or lazily create) the state of one agent.
 *
 * @param {any} agent
 * @param {{ promptMode: string, customPrompt: string, webSearch: boolean }} defaults
 * @returns {ChatSessionState}
 */
export function stateOf(agent, defaults) {
  const key = agent !== null && typeof agent === 'object' ? agent : {}
  let state = STATES.get(key)
  if (state === undefined) {
    state = {
      tone: defaults.promptMode,
      customPrompt: defaults.customPrompt,
      temperature: 'auto',
      web: defaults.webSearch,
    }
    STATES.set(key, state)
  }
  return state
}

/**
 * Resolve the temperature this request should carry.
 *
 * `auto` follows the preset configuration, except that the `creative` tone
 * raises it to the configured creative temperature unless the user pinned one
 * with `/temp`. `off` suppresses the value entirely.
 *
 * @param {ChatSessionState} state
 * @param {{ temperature: number | null, creativeTemperature: number }} options
 * @returns {number | null}
 */
export function resolveTemperature(state, options) {
  if (state.temperature === 'off') return null
  if (typeof state.temperature === 'number') return state.temperature
  if (state.tone === 'creative') return options.creativeTemperature
  return options.temperature
}

/**
 * Add one provider-reported usage chunk to a session.
 *
 * @param {string | undefined} sessionId
 * @param {{ inputTokens?: number, outputTokens?: number }} usage
 */
export function addUsage(sessionId, usage) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return
  const current = USAGE.get(sessionId) ?? { input: 0, output: 0, calls: 0 }
  current.input += Number(usage.inputTokens ?? 0)
  current.output += Number(usage.outputTokens ?? 0)
  current.calls += 1
  USAGE.set(sessionId, current)
}

/**
 * @param {string | undefined} sessionId
 * @returns {SessionUsage}
 */
export function usageOf(sessionId) {
  if (typeof sessionId !== 'string') return { input: 0, output: 0, calls: 0 }
  return USAGE.get(sessionId) ?? { input: 0, output: 0, calls: 0 }
}

/**
 * Compare this session's input tokens with the Standard baseline.
 *
 * The baseline is the measured input tokens of one Standard-mode message on a
 * plugin-heavy install, so the derived figure is an estimate, not a bill.
 *
 * @param {SessionUsage} usage
 * @param {number} baseline
 * @returns {{ calls: number, input: number, output: number, standardInput: number, saved: number, ratio: number }}
 */
export function savingsOf(usage, baseline) {
  const standardInput = baseline * Math.max(usage.calls, 0)
  const saved = standardInput - usage.input
  return {
    calls: usage.calls,
    input: usage.input,
    output: usage.output,
    standardInput,
    saved,
    ratio: usage.input === 0 ? 0 : standardInput / usage.input,
  }
}
