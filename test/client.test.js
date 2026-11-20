import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

const pkg = JSON.parse(read('package.json'))
const client = read('client.js')
const patch = read('cordis.patch.yml')
const main = read('src/index.js')

test('the browser half ships as the ./client export of the package', () => {
  assert.equal(pkg.exports?.['./client'], './client.js')
  assert.ok(pkg.files.includes('client.js'), 'files must list client.js')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.equal(pkg.dsh?.client?.immediately, true)
  assert.ok(
    pkg.dsh.client.inject?.includes('@deepseek-ai/dsh-client-ui-conversation'),
    'the client half needs the conversation UI package',
  )
})

test('client.js is a classic script registering one module factory', () => {
  // The loader appends a plain <script>; an ESM import/export anywhere in the
  // file would be a syntax error and silently leave the slot empty.
  assert.doesNotMatch(client, /^\s*(?:import|export)\s/m)
  assert.match(client, /window\.__ModuleLoader__\.load\(/)
  assert.match(client, /id: 'dsh-plugin-chat-mode'/)
  assert.match(client, /factory\(require\)/)
  assert.match(client, /require\('react'\)/)
})

test('the buttons mount into the composer and gate on the chat preset', () => {
  assert.match(client, /conversation\.input\.right/)
  assert.match(client, /id: 'chat-mode-toggles'/)
  assert.match(client, /const CHAT_PRESET = 'chat'/)
  assert.match(client, /preset !== CHAT_PRESET\) return null/)
  assert.match(client, /chat-toggle-thinking/)
  assert.match(client, /chat-toggle-web/)
})

test('the web toggle goes through the local /web command, not a model request', () => {
  assert.match(client, /remote\.commands\.execute\(sessionId, line, \[\]\)/)
  assert.match(client, /'\/web on' : '\/web off'/)
})

test('the thinking toggle shares the model directory store', () => {
  assert.match(client, /reasoningEffort: next/)
  assert.match(client, /const next = thinking \? 'off' : 'high'/)
  assert.match(client, /modelDirectories/)
})

test('the root patch row exists so the host can discover the client half', () => {
  // Preset child rows never reach the loader's entry registry, so the client
  // half needs a row of its own at the top level of the patch.
  assert.match(patch, /id: chat-mode-client/)
  assert.match(patch, /name: dsh-plugin-chat-mode/)
  assert.match(patch, /clientOnly: true/)
  // The host half must not start twice because of that row.
  assert.match(main, /clientOnly/)
})
