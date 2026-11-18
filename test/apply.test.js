import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../src/index.js'
import { WEB_TONE_PROMPT } from '../src/prompts.js'

/**
 * Build a fake preset context that records what the plugin registers.
 *
 * @param {Record<string, unknown>} [config]
 * @param {{ traceFile?: string }} [extra]
 */
function harness(config = {}, extra = {}) {
  /** @type {Array<any>} */
  const sections = []
  /** @type {Map<string, any>} */
  const listeners = new Map()
  let suppressed = 0
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'chat-mode-home-'))
  const ctx = {
    logger: { warn() {} },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
      suppressRuntimeContext() {
        suppressed += 1
        return () => {}
      },
    },
    effect(run) {
      run()
      return () => {}
    },
    on(name, listener) {
      listeners.set(name, listener)
    },
  }
  apply(ctx, {
    ...config,
    ...(extra.traceFile === undefined ? {} : { traceFile: extra.traceFile }),
  })
  return { sections, listeners, suppressed: () => suppressed }
}

/**
 * @param {{ provider?: string, model?: string, reasoningEffort?: string, names?: string[], rejectBatch?: boolean }} [options]
 */
function fakeAgent({ provider = 'deepseek-account', model = 'deepseek-flash', reasoningEffort, names = [], rejectBatch = false } = {}) {
  const selections = []
  /** @type {Array<{ deny?: readonly string[], allow?: readonly string[] }>} */
  const restrictions = []
  const agent = {
    model: {
      current: () => ({ provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }),
      select: (selection) => {
        selections.push(selection)
      },
    },
    ctx: {
      tools: {
        definitions: () => names.map((name) => ({ name })),
        restrict: (filter) => {
          if (rejectBatch && (filter.deny?.length ?? 0) > 1) throw new Error('reserved name')
          restrictions.push(filter)
          return () => {}
        },
      },
    },
  }
  return { agent, selections, restrictions }
}

test('registers one complete tone section and suppresses runtime context', () => {
  const { sections, suppressed } = harness()
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'chat-mode:prompt')
  assert.equal(sections[0].complete, true)
  assert.equal(sections[0].text, WEB_TONE_PROMPT)
  assert.equal(suppressed(), 1)
})

test('an empty prompt mode still registers the complete section with empty text', () => {
  const { sections } = harness({ promptMode: 'empty' })
  assert.equal(sections.length, 1)
  assert.equal(sections[0].text, '')
  assert.equal(sections[0].complete, true)
})

test('agent creation masks every inherited global tool', () => {
  const { listeners } = harness()
  const created = listeners.get('agent/created')
  assert.equal(typeof created, 'function')
  const { agent, restrictions } = fakeAgent({ names: ['bash', 'read', 'mcp__x__y'] })
  created({ agent, source: 'startup' })
  assert.deepEqual(restrictions, [{ deny: ['bash', 'read', 'mcp__x__y'] }])
})

test('an agent without inherited tools needs no restriction', () => {
  const { listeners } = harness()
  const { agent, restrictions } = fakeAgent({ names: [] })
  listeners.get('agent/created')({ agent, source: 'startup' })
  assert.deepEqual(restrictions, [])
})

test('one unusable tool name does not leave the others visible', () => {
  const { listeners } = harness()
  const { agent, restrictions } = fakeAgent({ names: ['code', 'read'], rejectBatch: true })
  listeners.get('agent/created')({ agent, source: 'startup' })
  assert.deepEqual(restrictions, [{ deny: ['code'] }, { deny: ['read'] }])
})

test('every later step re-masks tools registered lazily', () => {
  const { listeners } = harness()
  const preStep = listeners.get('agent/pre-step')
  assert.equal(typeof preStep, 'function')
  const { agent, restrictions } = fakeAgent({ names: ['late-tool'] })
  preStep({ agent })
  assert.deepEqual(restrictions, [{ deny: ['late-tool'] }])
})

test('default thinking reaches a startup session only', () => {
  const { listeners } = harness()
  const created = listeners.get('agent/created')
  for (const source of ['startup', 'clear']) {
    const { agent, selections } = fakeAgent({ reasoningEffort: 'high' })
    created({ agent, source })
    assert.deepEqual(selections, [{ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off' }])
  }
  for (const source of ['resume', 'compact']) {
    const { agent, selections } = fakeAgent({ reasoningEffort: 'high' })
    created({ agent, source })
    assert.deepEqual(selections, [])
  }
})

test('default thinking leaves other providers alone and follow-ui disables it', () => {
  const created = harness().listeners.get('agent/created')
  const other = fakeAgent({ provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V3' })
  created({ agent: other.agent, source: 'startup' })
  assert.deepEqual(other.selections, [])

  const follow = harness({ defaultThinking: 'follow-ui' }).listeners.get('agent/created')
  const chat = fakeAgent()
  follow({ agent: chat.agent, source: 'startup' })
  assert.deepEqual(chat.selections, [])
})

test('temperature is attached to non-thinking requests only', async () => {
  const { listeners } = harness({ temperature: 1 })
  const request = listeners.get('agent/request')
  const next = async () => ({ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 100 })

  const off = fakeAgent({ reasoningEffort: 'off' })
  const offConfig = await request({ agent: off.agent }, next)
  assert.equal(offConfig.temperature, 1)

  const thinking = fakeAgent({ reasoningEffort: 'high' })
  const thinkingConfig = await request({ agent: thinking.agent }, next)
  assert.equal(thinkingConfig.temperature, undefined)

  const disabled = harness({ temperature: null }).listeners.get('agent/request')
  const noTemperature = await disabled({ agent: off.agent }, next)
  assert.equal(noTemperature.temperature, undefined)
})

test('a trace file records the created decision and the effective request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-mode-'))
  const file = join(dir, 'trace.jsonl')
  const { listeners } = harness({}, { traceFile: file })
  const created = fakeAgent({ reasoningEffort: 'high' })
  listeners.get('agent/created')({ agent: created.agent, source: 'startup' })

  const request = listeners.get('agent/request')
  const next = async () => ({ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 100 })
  const off = fakeAgent({ reasoningEffort: 'off' })
  const result = await request({ agent: off.agent }, next)
  assert.equal(result.temperature, 1)

  const lines = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines.length, 2)
  assert.equal(lines[0].via, 'agent/created')
  assert.equal(lines[0].applied, true)
  assert.equal(lines[1].via, 'agent/request')
  assert.equal(lines[1].reasoningEffort, 'off')
  assert.equal(lines[1].temperature, 1)
})


