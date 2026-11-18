/**
 * Unit tests for the option layer and the request-shape helpers.
 *
 * Run with `npm test` (or `pnpm test`). The plugin itself is wired into DSH,
 * so these tests focus on the pure decisions: defaults, file precedence,
 * validation and the temperature gate.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  DEFAULTS,
  configFilePath,
  dshHome,
  loadOptions,
  readConfigFile,
  shouldSendTemperature,
} from '../src/options.js'
import { WEB_TONE_PROMPT, promptFor } from '../src/prompts.js'

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'chat-mode-test-'))
  try {
    return fn(home, { DSH_HOME: home })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('defaults apply when neither the row nor the file configures anything', () => {
  withHome((home, env) => {
    const options = loadOptions(undefined, { env })
    assert.deepEqual(options, { ...DEFAULTS })
    assert.equal(options.promptMode, 'web-tone')
    assert.equal(options.temperature, 1)
    assert.equal(options.defaultThinking, 'off')
    assert.equal(options.traceFile, null)
  })
})

test('the user file overrides the row config', () => {
  withHome((home, env) => {
    writeFileSync(join(home, 'chat-mode.json'), JSON.stringify({
      promptMode: 'custom',
      customPrompt: 'Be brief.',
      temperature: 0.6,
    }))
    const options = loadOptions({ promptMode: 'web-tone', temperature: 1.2 }, { env })
    assert.equal(options.promptMode, 'custom')
    assert.equal(options.customPrompt, 'Be brief.')
    assert.equal(options.temperature, 0.6)
  })
})

test('invalid values are dropped with a warning instead of failing the preset', () => {
  withHome((home, env) => {
    writeFileSync(join(home, 'chat-mode.json'), JSON.stringify({
      promptMode: 'marketing',
      temperature: 9,
      defaultThinking: 'always',
      surprise: true,
    }))
    const warnings = []
    const options = loadOptions(undefined, { env, warn: message => warnings.push(message) })
    assert.equal(options.promptMode, 'web-tone')
    assert.equal(options.temperature, 1)
    assert.equal(options.defaultThinking, 'off')
    assert.equal(warnings.length, 4)
  })
})

test('a malformed override file is ignored, not fatal', () => {
  withHome((home, env) => {
    writeFileSync(join(home, 'chat-mode.json'), '{ not json')
    const warnings = []
    const options = loadOptions(undefined, { env, warn: message => warnings.push(message) })
    assert.equal(options.promptMode, 'web-tone')
    assert.match(warnings[0], /not valid JSON/)
  })
})

test('DSH_HOME wins over the default home for the override path', () => {
  withHome((home, env) => {
    assert.equal(dshHome(env), home)
    assert.equal(configFilePath(env), join(home, 'chat-mode.json'))
    assert.deepEqual(readConfigFile(join(home, 'missing.json'), () => {}), {})
  })
})

test('temperature is only sent for a non-thinking request it has not set itself', () => {
  assert.equal(shouldSendTemperature('off', 1, undefined), true)
  assert.equal(shouldSendTemperature('off', 0, undefined), true)
  assert.equal(shouldSendTemperature('high', 1, undefined), false)
  assert.equal(shouldSendTemperature(undefined, 1, undefined), false)
  assert.equal(shouldSendTemperature('off', null, undefined), false)
  assert.equal(shouldSendTemperature('off', 1, 0.7), false)
})

test('prompt modes resolve to the tone prompt, the custom text or nothing', () => {
  assert.equal(promptFor({ promptMode: 'web-tone', customPrompt: '' }), WEB_TONE_PROMPT)
  assert.equal(promptFor({ promptMode: 'empty', customPrompt: 'ignored' }), '')
  assert.equal(promptFor({ promptMode: 'custom', customPrompt: '  Hi.  ' }), 'Hi.')
  assert.equal(promptFor({ promptMode: 'custom', customPrompt: '   ' }), '')
})

test('the shipped tone prompt stays short enough to be cheaper than one tool schema', () => {
  // 中文没有空格，按字符数做上限；DeepSeek 分词下 1 个常用汉字约 1 token，
  // 因此 90 字天然落在 80 tokens 的目标附近，并留出标点余量。
  assert.ok(WEB_TONE_PROMPT.length <= 90, `tone prompt has ${WEB_TONE_PROMPT.length} characters`)
  assert.ok(!WEB_TONE_PROMPT.includes('\n'), 'tone prompt stays on one line')
  assert.match(WEB_TONE_PROMPT, /用用户提问的语言回答/, 'tone prompt follows the user language')
  assert.match(WEB_TONE_PROMPT, /客服腔/, 'tone prompt rules out canned service phrasing')
})
