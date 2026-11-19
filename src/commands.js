/**
 * Local slash commands for the chat preset. They never reach the model: the
 * command service runs the handler in-process and answers with text, so using
 * them costs zero tokens and adds no tool schema.
 *
 * Commands: `/chat [help|savings|save]`, `/tone <web|empty|concise|creative|custom [text]>`,
 * `/temp <0-1.5|auto|off>`, `/web <on|off>`.
 *
 * @module dsh-plugin-chat-mode/commands
 */

import { clampTemperature, PROMPT_MODES, saveConfigFile, TEMPERATURE_MAX, TEMPERATURE_MIN } from './options.js'
import { promptForTone, TONES } from './prompts.js'
import { INSTANCE_ID, resolveTemperature, savingsOf, usageOf } from './session.js'

/** Text returned by `/chat help`. */
export const HELP_TEXT = [
  'Chat 是本地会话模式：/chat 下的命令都在本地执行，不消耗 token，也不发送工具定义。',
  '/chat            查看当前会话状态',
  '/chat help       显示本说明',
  '/chat savings    用本次会话的 usage 对照 Standard 基线估算省下的输入 token',
  '/chat save       把当前会话的语气、温度、联网开关写入 ~/.dsh/chat-mode.json',
  '/tone web|empty|concise|creative  切换语气档位（custom 需跟一段文案：/tone custom 你的提示词）',
  '/temp 0.9        设置温度（0–1.5）',
  '/temp auto       恢复预设默认温度（creative 档自动用 1.28）',
  '/temp off        不发送 temperature',
  '/web on|off      开关联网搜索与网页抓取（开启后只多 web_search / web_fetch 两个工具）',
].join('\n')

/**
 * @typedef {object} CommandDeps
 * @property {import('./options.js').ChatOptions} options
 * @property {(message: string) => void} warn
 * @property {(line: Record<string, unknown>) => void} [trace]
 * @property {string} savePath
 * @property {(agent: any) => import('./session.js').ChatSessionState} stateOf
 * @property {Record<string, string | undefined>} [env]
 */

/**
 * Describe the current session in one compact block.
 *
 * @param {import('./session.js').ChatSessionState} state
 * @param {import('./options.js').ChatOptions} options
 * @param {string} thinking
 * @returns {string}
 */
export function statusText(state, options, thinking) {
  const temperature = resolveTemperature(state, options)
  const temperatureText = temperature === null ? 'off' : String(temperature)
  return [
    `会话状态：tone=${state.tone}  temp=${temperatureText}  web=${state.web ? 'on' : 'off'}  thinking=${thinking}`,
    `系统提示：${promptForTone(state).length} 字符（${describePromptLength(state)}）`,
  ].join('\n')
}

/**
 * @param {import('./session.js').ChatSessionState} state
 * @returns {string}
 */
function describePromptLength(state) {
  const text = promptForTone(state)
  if (text.length === 0) return '为空，字段不出现'
  return 'complete 段，其余工程提示词全部丢弃'
}

/**
 * Answer `/chat savings` from locally accumulated usage.
 *
 * @param {import('./session.js').ChatSessionState} state
 * @param {import('./options.js').ChatOptions} options
 * @param {string | undefined} sessionId
 * @returns {string}
 */
export function savingsText(state, options, sessionId) {
  const usage = usageOf(sessionId)
  if (usage.calls === 0) return '还没有请求记录；先聊一句，再用 /chat savings 看估算。'
  const stats = savingsOf(usage, options.savingsBaseline)
  const sign = stats.saved >= 0 ? '省下' : '多用'
  return [
    `本次会话：${stats.calls} 次请求，输入 ${stats.input} tokens，输出 ${stats.output} tokens。`,
    `按 Standard 基线 ${options.savingsBaseline}/次 估算，${sign}约 ${Math.abs(stats.saved).toLocaleString('en-US')} 输入 tokens` +
      `${stats.ratio > 0 ? `（约 ${stats.ratio.toFixed(1)} 倍）` : ''}。`,
    '这是估算值，不是账单；仅按 token 计，未含缓存与思考 token 差异。',
  ].join('\n')
}

/**
 * Parse `/tone ...`; returns a change or an error message.
 *
 * @param {string} raw
 * @returns {{ tone?: string, customPrompt?: string, error?: string }}
 */
export function parseTone(raw) {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { error: `用法：/tone ${TONES.join('|')}` }
  const [head, ...rest] = trimmed.split(/\s+/)
  const alias = head === 'web' ? 'web-tone' : head
  if (!TONES.includes(alias)) return { error: `未知语气 "${head}"，可选：${TONES.join(', ')}` }
  if (alias === 'custom') {
    const text = rest.join(' ').trim()
    if (text.length === 0) return { error: 'custom 需要跟一段提示词，例如：/tone custom 你是简洁的助手' }
    return { tone: 'custom', customPrompt: text }
  }
  return { tone: alias }
}

/**
 * Parse `/temp ...`.
 *
 * @param {string} raw
 * @param {(message: string) => void} warn
 * @returns {{ temperature?: import('./session.js').TemperatureChoice, error?: string }}
 */
export function parseTemperature(raw, warn) {
  const value = raw.trim().toLowerCase()
  if (value === 'auto') return { temperature: 'auto' }
  if (value === 'off' || value === 'none') return { temperature: 'off' }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return { error: `温度需要是 ${TEMPERATURE_MIN}–${TEMPERATURE_MAX} 的数字，或 auto / off` }
  return { temperature: clampTemperature(parsed, warn, '/temp') }
}

/**
 * Register all chat commands on the preset scope.
 *
 * @param {any} ctx Preset-scoped Cordis context.
 * @param {CommandDeps} deps
 * @returns {void}
 */
export function registerChatCommands(ctx, deps) {
  const { options, warn, trace } = deps

  const handleStatus = (agent) => {
    const state = deps.stateOf(agent)
    const thinking = options.defaultThinking === 'off' ? '默认关（新会话）' : '跟随界面'
    return statusText(state, options, thinking)
  }

  const handleChat = (invocation) => {
    const agent = invocation?.agent
    const input = String(invocation?.rawInput ?? '').trim().toLowerCase()
    const state = deps.stateOf(agent)
    if (input === '' || input === 'status') return handleStatus(agent)
    if (input === 'help') return HELP_TEXT
    if (input === 'savings') return savingsText(state, options, agent?.session?.id)
    if (input === 'save') {
      /**
       * @type {Partial<import('./options.js').ChatOptions>}
       */
      const patch = {
        promptMode: /** @type {any} */ (state.tone),
        customPrompt: state.customPrompt,
        webSearch: state.web,
      }
      if (state.temperature === 'off') patch.temperature = null
      else if (typeof state.temperature === 'number') patch.temperature = state.temperature
      const ok = saveConfigFile(deps.savePath, patch, warn)
      trace?.({ via: 'command:save', ok, path: deps.savePath })
      return ok
        ? `已写入 ${deps.savePath}：tone=${state.tone} web=${state.web ? 'on' : 'off'}`
        : `写入 ${deps.savePath} 失败，详情见日志`
    }
    return `未知子命令 "${input}"。可用：/chat、/chat help、/chat savings、/chat save`
  }

  const handleTone = (invocation) => {
    const parsed = parseTone(String(invocation?.rawInput ?? ''))
    if (parsed.error !== undefined) return parsed.error
    const state = deps.stateOf(invocation?.agent)
    if (parsed.tone !== undefined) state.tone = parsed.tone
    if (parsed.customPrompt !== undefined) state.customPrompt = parsed.customPrompt
    trace?.({ via: 'command:tone', instance: INSTANCE_ID, sessionId: invocation?.agent?.session?.id ?? null, tone: state.tone, customLength: state.customPrompt.length })
    return `语气切到 ${state.tone}。系统提示 ${promptForTone(state).length} 字符。`
  }

  const handleTemperature = (invocation) => {
    const parsed = parseTemperature(String(invocation?.rawInput ?? ''), warn)
    if (parsed.error !== undefined) return parsed.error
    const state = deps.stateOf(invocation?.agent)
    if (parsed.temperature !== undefined) state.temperature = parsed.temperature
    const effective = resolveTemperature(state, options)
    trace?.({ via: 'command:temp', choice: state.temperature, effective })
    return `温度设为 ${String(state.temperature)}（下一轮生效：${effective === null ? '不发送' : String(effective)}）。`
  }

  const handleWeb = (invocation) => {
    const value = String(invocation?.rawInput ?? '').trim().toLowerCase()
    if (value !== 'on' && value !== 'off') return '用法：/web on|off'
    const state = deps.stateOf(invocation?.agent)
    state.web = value === 'on'
    trace?.({ via: 'command:web', instance: INSTANCE_ID, sessionId: invocation?.agent?.session?.id ?? null, web: state.web })
    if (!state.web) return '联网已关闭：请求里不再包含任何工具定义。'
    const providerHint = true
    return [
      '联网已开启：本轮起只额外提供 web_search 与 web_fetch 两个工具（约 +0.15K input tokens）。',
      providerHint
        ? '若要享受 DeepSeek 自 2026-11-18 起「模型调用触发的搜索/抓取不按次计费、只按 token」的政策，' +
          '请把 DSH 设置 → Web 搜索与抓取里的 Search Provider 改成 deepseek-official；' +
          '默认的 deepseek-search-api 仍按次收费（¥5/1k 次）。'
        : '',
    ].filter(Boolean).join('\n')
  }

  const definitions = [
    { name: 'chat', description: '查看会话状态；/chat help | savings | save', input: { hint: 'help | savings | save' }, handler: handleChat },
    { name: 'tone', description: '切换语气：web | empty | concise | creative | custom <text>', input: { hint: 'web | empty | concise | creative | custom <text>' }, handler: handleTone },
    { name: 'temp', description: '设置温度：0–1.5 | auto | off', input: { hint: '0-1.5 | auto | off' }, handler: handleTemperature },
    { name: 'web', description: '开关联网工具：on | off', input: { hint: 'on | off' }, handler: handleWeb },
  ]

  for (const definition of definitions) {
    try {
      ctx.commands.register({
        name: definition.name,
        description: definition.description,
        input: definition.input,
        // The rc.5 command contract is `{ kind: 'success', text }` or
        // `{ kind: 'error', text }`; anything else is rejected by the gateway.
        handler: (/** @type {any} */ invocation) => ({ kind: 'success', text: definition.handler(invocation) }),
      })
    } catch (error) {
      warn(`could not register /${definition.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** Re-exported so tests and callers can validate inputs without the registry. */
export { PROMPT_MODES }
