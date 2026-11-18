import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../src/index.js'
import { WEB_TONE_PROMPT } from '../src/prompts.js'

/**
 * Build a fake preset context that records what the plugin registers.
 *
 * @param {Record<string, unknown>} [config]
 * @param {{ traceFile?: string, presetNames?: string[], rejectPresetBatch?: boolean }} [extra]
 */
function harness(config = {}, extra = {}) {
  /** @type {Array<any>} */
  const sections = []
  /** @type {Map<string, any>} */
  const listeners = new Map()
  /** @type {Array<any>} */
  const presetRestrictions = []
  let suppressed = 0
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'chat-mode-home-'))
  const presetNames = extra.presetNames ?? []
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
    tools: {
      definitions: () => presetNames.map((name) => ({ name })),
      restrict: (filter) => {
        if (extra.rejectPresetBatch === true && (filter.deny?.length ?? 0) > 1) throw new Error('reserved name')
        presetRestrictions.push(filter)
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
  return { sections, listeners, presetRestrictions, suppressed: () => suppressed }
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

test('mounting masks every globally registered tool for the whole preset', () => {
  const { presetRestrictions } = harness({}, { presetNames: ['bash', 'read', 'mcp__x__y'] })
  assert.deepEqual(presetRestrictions, [{ deny: ['bash', 'read', 'mcp__x__y'] }])
})

test('an empty global tool set needs no preset restriction', () => {
  const { presetRestrictions } = harness()
  assert.deepEqual(presetRestrictions, [])
})

test('one unusable tool name at mount does not leave the others visible', () => {
  const { presetRestrictions } = harness({}, { presetNames: ['code', 'read'], rejectPresetBatch: true })
  assert.deepEqual(presetRestrictions, [{ deny: ['code'] }, { deny: ['read'] }])
})

test('agent creation masks every tool it still inherits', () => {
  const { listeners } = harness()
  const created = listeners.get('agent/created')
  assert.equal(typeof created, 'function')
  const { agent, restrictions } = fakeAgent({ names: ['late-tool', 'later-tool'] })
  created({ agent, source: 'startup' })
  assert.deepEqual(restrictions, [{ deny: ['late-tool', 'later-tool'] }])
})

test('an agent without inherited tools needs no restriction', () => {
  const { listeners } = harness()
  const { agent, restrictions } = fakeAgent({ names: [] })
  listeners.get('agent/created')({ agent, source: 'startup' })
  assert.deepEqual(restrictions, [])
})

test('every later step re-masks lazily registered tools and passes the decision through', async () => {
  const { listeners } = harness()
  const preStep = listeners.get('agent/pre-step')
  assert.equal(typeof preStep, 'function')
  const { agent, restrictions } = fakeAgent({ names: ['late-tool'] })
  const decision = { kind: 'enter', messages: [] }
  const result = await preStep({ agent }, () => Promise.resolve(decision))
  assert.deepEqual(restrictions, [{ deny: ['late-tool'] }])
  assert.equal(result, decision)
})

test('default thinking applies to the first turn of a fresh session only', () => {
  const { listeners } = harness()
  const claimed = listeners.get('agent/inbox/claimed')
  assert.equal(typeof claimed, 'function')

  const first = fakeAgent()
  claimed({ agent: first.agent, turn: 1 })
  assert.deepEqual(first.selections, [{ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off' }])

  const later = fakeAgent()
  claimed({ agent: later.agent, turn: 2 })
  assert.deepEqual(later.selections, [])

  const chosen = fakeAgent({ reasoningEffort: 'high' })
  claimed({ agent: chosen.agent, turn: 1 })
  assert.deepEqual(chosen.selections, [])

  const alreadyOff = fakeAgent({ reasoningEffort: 'off' })
  claimed({ agent: alreadyOff.agent, turn: 1 })
  assert.deepEqual(alreadyOff.selections, [])
})

test('default thinking leaves other providers alone and follow-ui disables it', () => {
  const claimed = harness().listeners.get('agent/inbox/claimed')
  const other = fakeAgent({ provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V3' })
  claimed({ agent: other.agent, turn: 1 })
  assert.deepEqual(other.selections, [])

  const follow = harness({ defaultThinking: 'follow-ui' }).listeners.get('agent/inbox/claimed')
  assert.equal(follow, undefined)
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

test('a trace file records the mount mask, the thinking decision and the request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-mode-'))
  const file = join(dir, 'trace.jsonl')
  const { listeners } = harness({}, { traceFile: file, presetNames: ['bash'] })
  const claimed = fakeAgent()
  listeners.get('agent/inbox/claimed')({ agent: claimed.agent, turn: 1 })

  const request = listeners.get('agent/request')
  const next = async () => ({ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 100 })
  const off = fakeAgent({ reasoningEffort: 'off' })
  const result = await request({ agent: off.agent }, next)
  assert.equal(result.temperature, 1)

  const lines = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines[0].via, 'apply')
  assert.equal(lines[0].defaultThinking, 'off')
  const maskLine = lines.find((line) => line.via === 'maskGlobalTools')
  assert.equal(maskLine?.count, 1)
  const claimedLine = lines.find((line) => line.via === 'agent/inbox/claimed')
  assert.equal(claimedLine?.applied, true)
  const requestLine = lines.at(-1)
  assert.equal(requestLine.via, 'agent/request')
  assert.equal(requestLine.reasoningEffort, 'off')
  assert.equal(requestLine.temperature, 1)
})
