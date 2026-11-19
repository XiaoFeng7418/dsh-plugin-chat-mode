/**
 * Option parsing for the chat preset: defaults, the Cordis row config and an
 * optional per-user `$DSH_HOME/chat-mode.json` override.
 *
 * Precedence, lowest to highest: built-in defaults, the `chat-mode` row config
 * in `cordis.patch.yml`, then `chat-mode.json`. The file exists because preset
 * sub-rows are deliberately read-only in the Web plugin inventory, so tuning a
 * preset must not mean editing the profile patch by hand.
 *
 * @module dsh-plugin-chat-mode/options
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * Fully resolved plugin options.
 *
 * @typedef {object} ChatOptions
 * @property {'web-tone' | 'empty' | 'concise' | 'creative' | 'custom'} promptMode
 * @property {string} customPrompt
 * @property {number | null} temperature
 * @property {'off' | 'follow-ui'} defaultThinking
 * @property {'deepseek-official' | 'inherit'} webSearchProvider
 * @property {boolean} webSearch
 * @property {number} creativeTemperature
 * @property {number} savingsBaseline
 * @property {string | null} traceFile
 */

/** Accepted `promptMode` values. */
export const PROMPT_MODES = Object.freeze(['web-tone', 'empty', 'concise', 'creative', 'custom'])

/** Accepted `defaultThinking` values. */
export const THINKING_MODES = Object.freeze(['off', 'follow-ui'])

/** Lowest accepted temperature. */
export const TEMPERATURE_MIN = 0

/** Highest accepted temperature. */
export const TEMPERATURE_MAX = 1.5

/** DeepSeek web-app-ish baseline input tokens for one Standard-mode message. */
export const DEFAULT_SAVINGS_BASELINE = 35967

/**
 * Built-in defaults; every field is user-tunable.
 *
 * @type {Readonly<ChatOptions>}
 */
export const DEFAULTS = Object.freeze({
  /** `web-tone` keeps a short tone prompt, `empty` sends no system prompt at all. */
  promptMode: 'web-tone',
  /** System prompt used when `promptMode` is `custom`. */
  customPrompt: '',
  /**
   * Temperature for non-thinking requests. `null` means "never send one".
   * 1.0 matches the DeepSeek web app's unfussy default for chat.
   */
  temperature: 1,
  /**
   * `off` starts a new chat without thinking unless the user already chose a
   * level; `follow-ui` leaves the adapter default (thinking on) alone.
   */
  defaultThinking: 'off',
  webSearchProvider: 'deepseek-official',
  /**
   * When true, the chat exposes exactly two web tools (`web_search`,
   * `web_fetch`) in addition to the usual zero tools. Off by default so the
   * request carries no `tools` field at all.
   */
  webSearch: false,
  /** Temperature paired with the `creative` tone when /temp is still `auto`. */
  creativeTemperature: 1.28,
  /** Standard-mode input tokens used by `/chat savings` as the comparison line. */
  savingsBaseline: DEFAULT_SAVINGS_BASELINE,
  /** Optional JSONL file that records the shape of sent chat requests. */
  traceFile: null,
})

/**
 * Resolve the DSH home directory the same way the harness does: a non-empty
 * `$DSH_HOME` wins, otherwise `~/.dsh`.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} Absolute home directory.
 */
export function dshHome(env = process.env) {
  const configured = env.DSH_HOME?.trim()
  return configured !== undefined && configured.length > 0 ? resolve(configured) : join(homedir(), '.dsh')
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} Absolute path of the optional user override file.
 */
export function configFilePath(env = process.env) {
  return join(dshHome(env), 'chat-mode.json')
}

/**
 * Read the optional JSON override file. A missing file is normal; a malformed
 * one is reported and ignored so a typo cannot make the preset unload.
 *
 * @param {string} file
 * @param {(message: string) => void} warn
 * @returns {Record<string, unknown>}
 */
export function readConfigFile(file, warn) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      warn(`ignoring ${file}: ${(/** @type {Error} */ (error)).message}`)
    }
    return {}
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    warn(`ignoring ${file}: not valid JSON`)
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    warn(`ignoring ${file}: expected a JSON object`)
    return {}
  }
  return parsed
}

/**
 * Write the given partial options into the user override file, preserving any
 * keys the plugin does not manage.
 *
 * @param {string} file
 * @param {Partial<ChatOptions>} patch
 * @param {(message: string) => void} warn
 * @returns {boolean} Whether the file was written.
 */
export function saveConfigFile(file, patch, warn) {
  try {
    const existing = readConfigFile(file, warn)
    const merged = { ...existing, ...patch }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    return true
  } catch (error) {
    warn(`could not write ${file}: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Keep valid fields from one layer and warn about rejected ones.
 *
 * @param {Record<string, unknown>} source
 * @param {(message: string) => void} warn
 * @param {string} label
 * @returns {Partial<ChatOptions>}
 */
function pick(source, warn, label) {
  /** @type {Partial<ChatOptions>} */
  const picked = {}
  const known = new Set(Object.keys(DEFAULTS))
  for (const key of Object.keys(source)) {
    if (!known.has(key)) warn(`${label}: unknown option "${key}" ignored`)
  }
  const { promptMode, customPrompt, temperature, defaultThinking, webSearch, webSearchProvider, creativeTemperature, savingsBaseline, traceFile } = source

  if (promptMode !== undefined) {
    if (typeof promptMode === 'string' && PROMPT_MODES.includes(promptMode)) {
      picked.promptMode = /** @type {ChatOptions['promptMode']} */ (promptMode)
    } else warn(`${label}: promptMode must be one of ${PROMPT_MODES.join(', ')}`)
  }
  if (customPrompt !== undefined) {
    if (typeof customPrompt === 'string') picked.customPrompt = customPrompt
    else warn(`${label}: customPrompt must be a string`)
  }
  if (temperature !== undefined) {
    if (temperature === null) picked.temperature = null
    else if (typeof temperature === 'number' && Number.isFinite(temperature)
      && temperature >= TEMPERATURE_MIN && temperature <= TEMPERATURE_MAX) {
      picked.temperature = temperature
    } else warn(`${label}: temperature must be null or a number between ${TEMPERATURE_MIN} and ${TEMPERATURE_MAX}`)
  }
  if (defaultThinking !== undefined) {
    if (typeof defaultThinking === 'string' && THINKING_MODES.includes(defaultThinking)) {
      picked.defaultThinking = /** @type {ChatOptions['defaultThinking']} */ (defaultThinking)
    } else warn(`${label}: defaultThinking must be one of ${THINKING_MODES.join(', ')}`)
  }
  if (webSearch !== undefined) {
    if (typeof webSearch === 'boolean') picked.webSearch = webSearch
    else warn(`${label}: webSearch must be true or false`)
  }
  if (webSearchProvider !== undefined) {
    if (webSearchProvider === 'deepseek-official' || webSearchProvider === 'inherit') {
      picked.webSearchProvider = webSearchProvider
    } else {
      warn(`${label}: webSearchProvider must be "deepseek-official" or "inherit"`)
    }
  }  if (creativeTemperature !== undefined) {
    if (typeof creativeTemperature === 'number' && Number.isFinite(creativeTemperature)) {
      picked.creativeTemperature = clampTemperature(creativeTemperature, warn, `${label}: creativeTemperature`)
    } else warn(`${label}: creativeTemperature must be a number`)
  }
  if (savingsBaseline !== undefined) {
    if (typeof savingsBaseline === 'number' && Number.isFinite(savingsBaseline) && savingsBaseline > 0) {
      picked.savingsBaseline = savingsBaseline
    } else warn(`${label}: savingsBaseline must be a positive number`)
  }
  if (traceFile !== undefined) {
    if (traceFile === null) picked.traceFile = null
    else if (typeof traceFile === 'string' && traceFile.trim().length > 0) picked.traceFile = traceFile
    else warn(`${label}: traceFile must be null or a non-empty path`)
  }
  return picked
}

/**
 * Clamp a temperature into the accepted range and report the adjustment.
 *
 * @param {number} value
 * @param {(message: string) => void} warn
 * @param {string} label
 * @returns {number}
 */
export function clampTemperature(value, warn, label) {
  const clamped = Math.min(TEMPERATURE_MAX, Math.max(TEMPERATURE_MIN, value))
  if (clamped !== value) warn(`${label}: ${value} clamped to ${clamped}`)
  return clamped
}

/**
 * Merge defaults, the row config and the user file, validating every layer.
 *
 * @param {Record<string, unknown> | undefined} config The row config from `cordis.patch.yml`.
 * @param {{ env?: Record<string, string | undefined>, warn?: (message: string) => void }} [options]
 * @returns {ChatOptions}
 */
export function loadOptions(config, options = {}) {
  const warn = options.warn ?? (() => {})
  const env = options.env ?? process.env
  const file = readConfigFile(configFilePath(env), warn)
  return {
    ...DEFAULTS,
    ...pick(config ?? {}, warn, 'cordis config'),
    ...pick(file, warn, 'chat-mode.json'),
  }
}

/**
 * Decide whether this request may carry the configured temperature.
 *
 * The DeepSeek adapter maps a reasoning effort of `off` to `thinking: disabled`
 * and every other effort to `thinking: enabled`; a missing effort means the
 * adapter default (thinking on). Temperature is only meaningful while thinking
 * is disabled, so an enabled/unknown thinking state must not receive one.
 *
 * @param {string | undefined} effectiveEffort
 * @param {number | null} configuredTemperature
 * @param {number | undefined} currentTemperature A value the caller already set.
 * @returns {boolean}
 */
export function shouldSendTemperature(effectiveEffort, configuredTemperature, currentTemperature) {
  if (configuredTemperature === null || configuredTemperature === undefined) return false
  if (currentTemperature !== undefined) return false
  return effectiveEffort === 'off'
}

/**
 * Only DeepSeek routes accept `reasoningEffort: 'off'` in this harness build;
 * other adapters reject the value, so `defaultThinking: off` must stay scoped
 * to them rather than breaking an unrelated provider.
 *
 * @param {string | undefined} provider
 * @returns {boolean}
 */
export function isDeepSeekProvider(provider) {
  return typeof provider === 'string' && provider.toLowerCase().startsWith('deepseek')
}
