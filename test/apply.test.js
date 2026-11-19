import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../src/index.js'
import { CONCISE_PROMPT, CREATIVE_PROMPT, WEB_TONE_PROMPT } from '../src/prompts.js'

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
  /** @type {Array<any>} */
  const commands = []
  /** @type {Array<{ definition: any, options: any }>} */
  const registeredTools = []
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
    commands: {
      register(definition) {
        commands.push(definition)
        return () => {}
      },
    },
    web: {
      async search() {
        return { sources: [], truncated: false }
      },
      async fetch() {
        return { url: 'https://example.com', statusCode: 200, body: { kind: 'text', content: 'ok' }, truncated: false }
      },
    },
    tools: {
      definitions: () => presetNames.map((name) => ({ name })),
      restrict: (filter) => {
        if (extra.rejectPresetBatch === true && (filter.deny?.length ?? 0) > 1) throw new Error('reserved name')
        presetRestrictions.push(filter)
        return () => {}
      },
      register: (definition, options) => {
        registeredTools.push({ definition, options })
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
  const command = (/** @type {string} */ name) => commands.find((entry) => entry.name === name)
  const run = (/** @type {string} */ name, /** @type {any} */ agent, /** @type {string} */ rawInput) => {
    const entry = command(name)
    assert.ok(entry !== undefined, `command /${name} should be registered`)
    return entry.handler({ agent, rawInput })
  }
  return {
    sections, listeners, presetRestrictions, commands, registeredTools, run, suppressed: () => suppressed,
  }
}

/**
 * @param {{ provider?: string, model?: string, reasoningEffort?: string, names?: string[], rejectBatch?: boolean, sessionId?: string }} [options]
 */
function fakeAgent({ provider = 'deepseek-account', model = 'deepseek-flash', reasoningEffort, names = [], rejectBatch = false, sessionId = 'session-test' } = {}) {
  const selections = []
  /** @type {Array<{ deny?: readonly string[], allow?: readonly string[] }>} */
  const restrictions = []
  const agent = {
    session: { id: sessionId },
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

/**
 * @param {any[]} sections
 * @param {any} agent
 * @returns {string}
 */
function sectionText(sections, agent) {
  const text = sections[0].text
  return typeof text === 'function' ? text({ agent }) : text
}

test('registers one complete tone section with an agent-aware text function', () => {
  const { sections, suppressed } = harness()
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'chat-mode:prompt')
  assert.equal(sections[0].complete, true)
  assert.equal(typeof sections[0].text, 'function')
  assert.equal(sectionText(sections, fakeAgent().agent), WEB_TONE_PROMPT)
  assert.equal(suppressed(), 1)
})

test('an empty prompt mode still registers the complete section with empty text', () => {
  const { sections } = harness({ promptMode: 'empty' })
  assert.equal(sectionText(sections, fakeAgent().agent), '')
})

test('tone and temperature are per session', () => {
  const h = harness()
  const a = fakeAgent().agent
  const b = fakeAgent().agent
  assert.equal(sectionText(h.sections, a), WEB_TONE_PROMPT)
  h.run('tone', a, 'concise')
  assert.equal(sectionText(h.sections, a), CONCISE_PROMPT)
  assert.equal(sectionText(h.sections, b), WEB_TONE_PROMPT)
  h.run('tone', b, 'creative')
  assert.equal(sectionText(h.sections, b), CREATIVE_PROMPT)
})

test('/tone custom requires text and stores it', () => {
  const h = harness()
  const agent = fakeAgent().agent
  const missing = h.run('tone', agent, 'custom')
  assert.match(missing.text, /custom 需要/u)
  const set = h.run('tone', agent, 'custom 你是简洁的助手')
  assert.match(set.text, /custom/u)
  assert.equal(sectionText(h.sections, agent), '你是简洁的助手')
})

test('mounting masks every globally registered tool for the whole preset', () => {
  const { presetRestrictions } = harness({}, { presetNames: ['bash', 'read', 'mcp__x__y'] })
  assert.deepEqual(presetRestrictions, [{ deny: ['bash', 'read', 'mcp__x__y'] }])
})

test('one unusable tool name at mount does not leave the others visible', () => {
  const { presetRestrictions } = harness({}, { presetNames: ['code', 'read'], rejectPresetBatch: true })
  assert.deepEqual(presetRestrictions, [{ deny: ['code'] }, { deny: ['read'] }])
})

test('the web tools stay hidden until /web on, and only those two are added', () => {
  const h = harness()
  assert.deepEqual(h.registeredTools.map((entry) => entry.definition.name), ['web_search', 'web_fetch'])
  const agent = fakeAgent().agent
  const when = h.registeredTools[0].options.when
  assert.equal(when({ agent }), false)
  h.run('web', agent, 'on')
  assert.equal(when({ agent }), true)
  h.run('web', agent, 'off')
  assert.equal(when({ agent }), false)
})

test('agent creation and later steps mask every tool the agent still inherits', async () => {
  const { listeners } = harness()
  const created = fakeAgent({ names: ['late-tool', 'later-tool'] })
  listeners.get('agent/created')({ agent: created.agent, source: 'startup' })
  assert.deepEqual(created.restrictions, [{ deny: ['late-tool', 'later-tool'] }])

  const stepped = fakeAgent({ names: ['late-tool'] })
  const decision = { kind: 'enter', messages: [] }
  const result = await listeners.get('agent/pre-step')({ agent: stepped.agent }, () => Promise.resolve(decision))
  assert.deepEqual(stepped.restrictions, [{ deny: ['late-tool'] }])
  assert.equal(result, decision)
})

test('default thinking applies to the first turn of a fresh session only', () => {
  const { listeners } = harness()
  const claimed = listeners.get('agent/inbox/claimed')
  const first = fakeAgent()
  claimed({ agent: first.agent, turn: 1 })
  assert.deepEqual(first.selections, [{ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off' }])
  const later = fakeAgent()
  claimed({ agent: later.agent, turn: 2 })
  assert.deepEqual(later.selections, [])
  const chosen = fakeAgent({ reasoningEffort: 'high' })
  claimed({ agent: chosen.agent, turn: 1 })
  assert.deepEqual(chosen.selections, [])
})

test('temperature follows /temp and the creative default', async () => {
  const h = harness({ temperature: 1, creativeTemperature: 1.3 })
  const request = h.listeners.get('agent/request')
  const next = async () => ({ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 100 })

  const plain = fakeAgent({ reasoningEffort: 'off' })
  assert.equal((await request({ agent: plain.agent }, next)).temperature, 1)

  h.run('temp', plain.agent, '0.4')
  assert.equal((await request({ agent: plain.agent }, next)).temperature, 0.4)

  const creative = fakeAgent({ reasoningEffort: 'off' })
  h.run('tone', creative.agent, 'creative')
  assert.equal((await request({ agent: creative.agent }, next)).temperature, 1.3)

  h.run('temp', creative.agent, 'off')
  assert.equal((await request({ agent: creative.agent }, next)).temperature, undefined)

  const thinking = fakeAgent({ reasoningEffort: 'high' })
  assert.equal((await request({ agent: thinking.agent }, next)).temperature, undefined)
})

test('llm/stream usage feeds /chat savings', async () => {
  const h = harness({ savingsBaseline: 1000 })
  const stream = h.listeners.get('llm/stream')
  const agent = fakeAgent({ sessionId: 'session-x' }).agent
  const wrapped = stream({ sessionId: 'session-x' }, async function* () {
    yield { type: 'text-delta' }
    yield { type: 'usage', usage: { inputTokens: 400, outputTokens: 20 } }
    yield { type: 'finish' }
  })
  const chunks = []
  for await (const chunk of wrapped) chunks.push(chunk.type)
  assert.deepEqual(chunks, ['text-delta', 'usage', 'finish'])

  const savings = h.run('chat', agent, 'savings')
  assert.match(savings.text, /1 次请求/u)
  assert.match(savings.text, /400/u)
  assert.match(savings.text, /600/u)
})

test('/chat save writes the current session into the user override file', () => {
  const h = harness()
  const agent = fakeAgent().agent
  h.run('tone', agent, 'concise')
  h.run('temp', agent, '0.7')
  h.run('web', agent, 'on')
  const saved = h.run('chat', agent, 'save')
  assert.match(saved.text, /chat-mode\.json/u)
  const file = join(process.env.DSH_HOME ?? '', 'chat-mode.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(parsed.promptMode, 'concise')
  assert.equal(parsed.temperature, 0.7)
  assert.equal(parsed.webSearch, true)
})

test('a trace file records the mount mask, the usage and the request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-mode-'))
  const file = join(dir, 'trace.jsonl')
  const h = harness({}, { traceFile: file, presetNames: ['bash'] })
  const claimed = fakeAgent()
  h.listeners.get('agent/inbox/claimed')({ agent: claimed.agent, turn: 1 })
  const off = fakeAgent({ reasoningEffort: 'off' })
  const next = async () => ({ provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 100 })
  const result = await h.listeners.get('agent/request')({ agent: off.agent }, next)
  assert.equal(result.temperature, 1)

  const stream = h.listeners.get('llm/stream')
  const chunks = stream({ sessionId: 'session-t' }, async function* () {
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 1 } }
  })
  for await (const _chunk of chunks) {
    /* drain */
  }

  const lines = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines[0].via, 'apply')
  assert.equal(lines.find((line) => line.via === 'maskGlobalTools')?.count, 1)
  assert.equal(lines.find((line) => line.via === 'agent/inbox/claimed')?.applied, true)
  assert.equal(lines.find((line) => line.via === 'llm/usage')?.input, 7)
  const requestLine = lines.find((line) => line.via === 'agent/request')
  assert.equal(requestLine?.temperature, 1)
})
