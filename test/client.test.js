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

test('the toggles use the chat-demo outline icons instead of emoji', () => {
  assert.doesNotMatch(client, /\u{1F9E0}|\u{1F310}/u, 'emoji glyphs must be gone')
  assert.match(client, /function ThinkIcon\(\)/)
  assert.match(client, /function GlobeIcon\(\)/)
  assert.match(client, /viewBox: '0 0 14 14'/)
  assert.match(client, /fill: 'currentColor'/)
})

test('the toggles carry the chat-demo geometry and theme tokens', () => {
  assert.match(client, /chat-mode-toggle\b/)
  assert.match(client, /height: 34px/)
  assert.match(client, /border-radius: 18px/)
  assert.match(client, /font-size: 13px/)
  assert.match(client, /--cm-border: rgba\(15, 17, 20, 0\.14\)/)
  assert.match(client, /--cm-accent: #4d6bfe/)
  assert.match(client, /--cm-accent: #7c97ff/)
  assert.match(client, /data-theme/)
  assert.match(client, /label\('联网搜索', 'Search'\)/)
})

test('the icons keep their chat-demo attribution', () => {
  assert.match(client, /deepseek-ai\/chat-demo/)
  assert.ok(pkg.files.includes('NOTICE'), 'the MIT notice must ship in the package')
})

test('state changes ease instead of snapping', () => {
  assert.match(client, /background-color 180ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/)
  assert.match(client, /border-color 180ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/)
  assert.match(client, /color 180ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/)
  assert.match(client, /box-shadow 180ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/)
  assert.match(client, /button\.chat-mode-toggle:active:not\(:disabled\) \{\s*transform: scale\(0\.96\)/)
  assert.match(client, /transition-duration: 100ms/)
  assert.match(client, /prefers-reduced-motion: reduce/)
  assert.match(client, /animation: none !important/)
})

test('activation rotates the icon once with the DeepSeek easing', () => {
  assert.doesNotMatch(client, /chat-mode-icon-pop/, 'the old scale-bounce must be gone')
  assert.match(client, /@keyframes chat-mode-spin-think\s*\{\s*from \{ transform: rotate\(0deg\); \}\s*to \{ transform: rotate\(180deg\); \}/)
  assert.match(client, /@keyframes chat-mode-spin-web\s*\{\s*from \{ transform: rotate\(-24deg\); \}\s*to \{ transform: rotate\(0deg\); \}/)
  assert.match(client, /chat-mode-spin-think 440ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/)
  assert.match(client, /chat-mode-spin-web 400ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/)
  assert.match(client, /transform-origin: center/)
  assert.match(client, /transform-box: fill-box/)
  // The animation must hang off the one-shot marker, never off the resting state.
  assert.match(client, /\[data-spin='think'\] \.chat-mode-icon svg/)
  assert.match(client, /\[data-spin='web'\] \.chat-mode-icon svg/)
  assert.doesNotMatch(client, /\[aria-pressed='true'\] svg \{\s*animation/)
})

test('the spin marker only fires on a real off -> on transition', () => {
  assert.match(client, /const previous = React\.useRef\(active\)/)
  assert.match(client, /previous\.current === false && active === true/)
  assert.match(client, /previous\.current = active/)
  assert.match(client, /setSpin\(kind\)/)
  assert.match(client, /setTimeout\(\(\) => setSpin\(null\)/)
  // A keyed wrapper is what restarts the CSS animation on the second activation.
  assert.match(client, /iconKey: `\$\{kind\}-\$\{sequence\}`/)
  assert.match(client, /key: props\.iconKey/)
})

test('the pill owns its border so no square host frame can appear', () => {
  assert.match(client, /\.chat-mode-toggles button\.chat-mode-toggle \{/)
  assert.match(client, /appearance: none/)
  assert.match(client, /-webkit-appearance: none/)
  assert.match(client, /border-style: solid/)
  assert.match(client, /border-width: 1px/)
  assert.match(client, /border-color: var\(--cm-border\)/)
  assert.match(client, /box-shadow: none/)
  assert.match(client, /-webkit-tap-highlight-color: transparent/)
  assert.doesNotMatch(client, /border: 1px solid var\(--dsw-alias-border-l2/)
})

test('focus and active states glow softly instead of drawing a hard box', () => {
  assert.match(client, /\.chat-mode-toggles button\.chat-mode-toggle:focus \{\s*outline: none;\s*box-shadow: none;/)
  assert.match(client, /button\.chat-mode-toggle:focus-visible \{\s*outline: none;\s*border-color: var\(--cm-accent\);\s*box-shadow: 0 0 0 2px var\(--cm-focus\);/)
  assert.match(client, /--cm-focus: rgba\(77, 107, 254, 0\.25\)/)
  assert.match(client, /--cm-focus: rgba\(124, 151, 255, 0\.32\)/)
  assert.match(client, /outline: none/)
  // The resting/selected state keeps the ring for the keyboard only.
  assert.match(client, /button\.chat-mode-toggle\[aria-pressed='true'\] \{[^}]*box-shadow: none;/)
})

test('the tooltip is a delayed CSS bubble, not a native title', () => {
  assert.doesNotMatch(client, /title:/, 'a native title would pop instantly and ignore the theme')
  assert.match(client, /'data-tooltip': props\.tooltip/)
  assert.match(client, /'aria-description': props\.tooltip/)
  assert.match(client, /content: attr\(data-tooltip\)/)
  assert.match(client, /opacity: 0;\s*transform: translate\(-50%, 4px\)/)
  assert.match(client, /opacity 160ms ease, transform 160ms ease/)
  assert.match(client, /pointer-events: none/)
  assert.match(client, /\.chat-mode-toggles \.chat-mode-toggle:hover::after \{[\s\S]*?transition-delay: 380ms/)
  assert.match(client, /transition-delay: 0ms/)
  assert.match(client, /\.chat-mode-toggles \.chat-mode-toggle:active::after,\s*\.chat-mode-toggles \.chat-mode-toggle:focus-visible::after/)
})

test('a click suppresses the tooltip until the pointer leaves', () => {
  assert.match(client, /data-tooltip-muted/)
  assert.match(client, /\[data-tooltip-muted='true'\]::after \{\s*content: none;/)
  assert.match(client, /onPointerDown: props\.onPointerDown/)
  assert.match(client, /onPointerLeave: props\.onPointerLeave/)
  assert.match(client, /onPointerDown: \(\) => mute\('think', true\)/)
  assert.match(client, /onPointerLeave: \(\) => mute\('think', false\)/)
  assert.match(client, /onPointerDown: \(\) => mute\('web', true\)/)
  assert.match(client, /onPointerLeave: \(\) => mute\('web', false\)/)
})

test('the tooltip copy matches the product wording', () => {
  assert.match(client, /label\('先思考后回答，解决推理问题', 'Think before answering to solve reasoning tasks'\)/)
  assert.match(client, /label\('按需搜索网页', 'Search the web as needed'\)/)
  assert.match(client, /--cm-tip-bg: #ffffff/)
  assert.match(client, /--cm-tip-bg: #23262d/)
  assert.match(client, /border: 1px solid var\(--cm-tip-border\)/)
})