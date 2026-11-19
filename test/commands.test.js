import assert from 'node:assert/strict'
import { test } from 'node:test'
import { savingsText, parseTemperature, parseTone, statusText } from '../src/commands.js'
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

test('savingsOf compares the accumulated input against the Standard baseline', () => {
  const usage = { calls: 2, input: 3800, output: 40 }
  const stats = savingsOf(usage, 10000)
  assert.equal(stats.calls, 2)
  assert.equal(stats.standardInput, 20000)
  assert.equal(stats.saved, 16200)
  assert.equal(stats.ratio.toFixed(2), '5.26')
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
  const empty = { tone: 'web-tone', customPrompt: '', temperature: 'auto', web: false }
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
  const webState = { tone: 'web-tone', customPrompt: '', temperature: 'auto', web: false }
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
