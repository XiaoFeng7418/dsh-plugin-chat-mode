import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseThink, registerChatCommands, savingsText, parseTemperature, parseTone, statusText } from '../src/commands.js'
import { DEFAULTS } from '../src/options.js'
import { CONCISE_PROMPT, CREATIVE_PROMPT, WEB_TONE_PROMPT } from '../src/prompts.js'
import { addUsage, savingsOf, usageOf } from '../src/session.js'

const warn = () => {}

test('parseTone accepts every tone name and the web alias', () => {
  assert.deepEqual(parseTone('web'), { tone: 'web-tone' })
  assert.deepEqual(parseTone('web-tone'), { tone: 'web-tone' })
  assert.deepEqual(parseTone('empty'), { tone: 'empty' })
  assert.deepEqual(parseTone('concise'), { tone: 'concise' })
  assert.deepEqual(parseTone('creative'), { tone: 'creative' })
  assert.deepEqual(parseTone('custom 你是助手'), { tone: 'custom', customPrompt: '你是助手' })
})

test('parseTone rejects unknown tones, empty input and custom without text', () => {
  assert.match(parseTone('').error ?? '', /用法/u)
  assert.match(parseTone('angry').error ?? '', /未知语气/u)
  assert.match(parseTone('custom').error ?? '', /custom 需要/u)
  assert.match(parseTone('custom    ').error ?? '', /custom 需要/u)
})

test('parseTemperature handles auto, off, numbers and clamping', () => {
  assert.deepEqual(parseTemperature('auto', warn), { temperature: 'auto' })
  assert.deepEqual(parseTemperature('OFF', warn), { temperature: 'off' })
  assert.deepEqual(parseTemperature('none', warn), { temperature: 'off' })
  assert.deepEqual(parseTemperature('0.7', warn), { temperature: 0.7 })
  assert.deepEqual(parseTemperature('1.5', warn), { temperature: 1.5 })
  assert.deepEqual(parseTemperature('9', warn), { temperature: 1.5 })
  assert.deepEqual(parseTemperature('-3', warn), { temperature: 0 })
  assert.match(parseTemperature('hot', warn).error ?? '', /温度需要是/u)
})

test('parseTemperature rejects an empty argument instead of silently using zero', () => {
  assert.match(parseTemperature('', warn).error ?? '', /用法/u)
  assert.match(parseTemperature('   ', warn).error ?? '', /用法/u)
})

test('parseTone trims the custom text and collapses inner whitespace', () => {
  assert.deepEqual(parseTone('custom  be  exact '), { tone: 'custom', customPrompt: 'be exact' })
})

test('the /chat command names the isolated search channel in user terms', () => {
  /** @type {import('../src/session.js').ChatSessionState} */
  const state = { tone: 'web-tone', customPrompt: '', temperature: 'auto', thinking: 'auto', web: false }
  /**
   * @param {import('../src/options.js').ChatOptions} options
   * @returns {string}
   */
  const runChat = (options) => {
    /** @type {Map<string, any>} */
    const registered = new Map()
    const ctx = {
      commands: {
        register(definition) {
          registered.set(definition.name, definition)
          return () => {}
        },
      },
    }
    registerChatCommands(ctx, { options, warn, savePath: 'C:/tmp/unused.json', stateOf: () => state })
    const entry = registered.get('chat')
    assert.ok(entry !== undefined)
    return entry.handler({ agent: { session: { id: 'session-channel' } }, rawInput: '' }).text
  }
  const isolated = runChat({ ...DEFAULTS, webSearchProvider: 'deepseek-official' })
  assert.match(isolated, /预设内独立隔离/u)
  assert.match(isolated, /deepseek-official/u)
  assert.match(isolated, /免按次费/u)
  const inherited = runChat({ ...DEFAULTS, webSearchProvider: 'inherit' })
  assert.match(inherited, /跟随宿主/u)
})

test('savingsOf compares the accumulated input against the Standard baseline', () => {
  const usage = { calls: 2, input: 3800, output: 40 }
  const stats = savingsOf(usage, 10000)
  assert.equal(stats.calls, 2)
  assert.equal(stats.standardInput, 20000)
  assert.equal(stats.saved, 16200)
  assert.equal(stats.ratio.toFixed(2), '5.26')
})

test('savingsOf reports a ratio of zero when the baseline is not lower', () => {
  const stats = savingsOf({ calls: 1, input: 5000, output: 0 }, 35967)
  assert.ok(stats.saved > 0)
  const tiny = savingsOf({ calls: 0, input: 0, output: 0 }, 35967)
  assert.equal(tiny.saved, 0)
  assert.equal(tiny.ratio, 0)
})

test('usage accumulates per session id and starts empty', () => {
  const first = usageOf('session-savings-a')
  assert.deepEqual(first, { calls: 0, input: 0, output: 0 })
  addUsage('session-savings-a', { inputTokens: 100, outputTokens: 5 })
  addUsage('session-savings-a', { inputTokens: 200, outputTokens: 7 })
  assert.deepEqual(usageOf('session-savings-a'), { calls: 2, input: 300, output: 12 })
  assert.deepEqual(usageOf('session-savings-b'), { calls: 0, input: 0, output: 0 })
})

test('savingsText explains an empty session and then the estimate', () => {
  const options = { ...DEFAULTS, savingsBaseline: 1000 }
  /** @type {import('../src/session.js').ChatSessionState} */
  const empty = { tone: 'web-tone', customPrompt: '', temperature: 'auto', thinking: 'auto', web: false }
  assert.match(savingsText(empty, options, 'session-none'), /还没有请求记录/u)
  addUsage('session-with-usage', { inputTokens: 400, outputTokens: 20 })
  const text = savingsText(empty, options, 'session-with-usage')
  assert.match(text, /1 次请求/u)
  assert.match(text, /输入 400 tokens/u)
  assert.match(text, /省下约 600/u)
  assert.match(text, /估算值/u)
})

test('statusText reports tone, temperature, web and the prompt length', () => {
  const options = DEFAULTS
  /** @type {import('../src/session.js').ChatSessionState} */
  const webState = { tone: 'web-tone', customPrompt: '', temperature: 'auto', thinking: 'auto', web: false }
  const web = statusText(webState, options, '默认关（新会话）')
  assert.match(web, /tone=web-tone/u)
  assert.match(web, /temp=1/u)
  assert.match(web, /web=off/u)
  assert.equal(web.includes(String(WEB_TONE_PROMPT.length)), true)

  const concise = statusText({ ...webState, tone: 'concise' }, options, '默认关（新会话）')
  assert.equal(concise.includes(String(CONCISE_PROMPT.length)), true)

  const creative = statusText({ ...webState, tone: 'creative' }, options, '默认关（新会话）')
  assert.match(creative, /temp=1.28/u)
  assert.equal(creative.includes(String(CREATIVE_PROMPT.length)), true)

  const off = statusText({ ...webState, temperature: 'off', web: true }, options, '跟随界面')
  assert.match(off, /temp=off/u)
  assert.match(off, /web=on/u)
})

test('parseThink maps on/off aliases and accepts low/high/max/auto', () => {
  assert.deepEqual(parseThink('on'), { thinking: 'high', effort: 'high' })
  assert.deepEqual(parseThink('OFF'), { thinking: 'off', effort: 'off' })
  assert.deepEqual(parseThink('low'), { thinking: 'low', effort: 'low' })
  assert.deepEqual(parseThink('max'), { thinking: 'max', effort: 'max' })
  assert.deepEqual(parseThink('auto'), { thinking: 'auto' })
  assert.match(parseThink('').error ?? '', /用法/u)
  assert.match(parseThink('turbo').error ?? '', /未知思考档位/u)
})

test('/think switches the recorded level and selects the adapter effort', () => {
  /** @type {Map<string, any>} */
  const registered = new Map()
  const ctx = {
    commands: {
      register(definition) {
        registered.set(definition.name, definition)
        return () => {}
      },
    },
  }
  /** @type {import('../src/session.js').ChatSessionState} */
  const state = { tone: 'web-tone', customPrompt: '', temperature: 'auto', thinking: 'auto', web: false }
  /** @type {any[]} */
  const selections = []
  const agent = {
    session: { id: 'session-think' },
    model: {
      current: () => ({ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: state.thinking === 'auto' ? undefined : state.thinking }),
      select(selection) { selections.push(selection) },
    },
  }
  registerChatCommands(ctx, { options: DEFAULTS, warn, savePath: 'C:/tmp/unused.json', stateOf: () => state })
  const think = registered.get('think')
  assert.ok(think !== undefined)

  const on = think.handler({ agent, rawInput: 'on' }).text
  assert.equal(state.thinking, 'high')
  assert.deepEqual(selections.at(-1), { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' })
  assert.match(on, /high/u)
  assert.match(on, /不发送 temperature/u)

  think.handler({ agent, rawInput: 'off' })
  assert.equal(state.thinking, 'off')
  assert.deepEqual(selections.at(-1), { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off' })

  const auto = think.handler({ agent, rawInput: 'auto' }).text
  assert.equal(state.thinking, 'auto')
  assert.deepEqual(selections.at(-1), { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.match(auto, /适配器默认/u)
})
