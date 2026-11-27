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
  assert.match(client, /button\.chat-mode-toggle:active \{\s*transform: scale\(0\.96\)/)
  assert.match(client, /transition-duration: 100ms/)
  assert.match(client, /prefers-reduced-motion: reduce/)
  assert.match(client, /animation: none !important/)
})

test('the think icon is a layered atom, not a rotating whole svg', () => {
  assert.doesNotMatch(client, /chat-mode-icon-pop/, 'the old scale-bounce must be gone')
  // Two tilted elliptical orbits, each its own group, plus a fixed centre core.
  assert.equal((client.match(/cm-think-orbit cm-think-orbit-a/g) ?? []).length, 1)
  assert.equal((client.match(/cm-think-orbit cm-think-orbit-b/g) ?? []).length, 1)
  assert.match(client, /createElement\('ellipse', \{\s*cx: 7,\s*cy: 7,\s*rx: 6,\s*ry: 2\.6,\s*transform: 'rotate\(45 7 7\)'/)
  assert.match(client, /createElement\('ellipse', \{\s*cx: 7,\s*cy: 7,\s*rx: 6,\s*ry: 2\.6,\s*transform: 'rotate\(-45 7 7\)'/)
  assert.match(client, /className: 'cm-think-core',\s*cx: 7,\s*cy: 7,\s*r: 1\.15,\s*fill: 'currentColor'/)
  // Each layer must rotate around its own centre, never the viewport origin.
  assert.match(client, /\.cm-think-orbit,\s*\.cm-think-core \{\s*transform-box: fill-box;\s*transform-origin: center;/)
  // The svg itself must never be the animated element.
  assert.doesNotMatch(client, /\[data-turn\] \.chat-mode-icon svg\s*\{/)
  assert.doesNotMatch(client, /\[aria-pressed='true'\] \.chat-mode-icon svg\s*\{\s*animation/)
})

test('turn on sweeps the two orbits in opposite directions with a stagger', () => {
  assert.match(client, /\.chat-mode-toggle\[data-turn='on'\] \.cm-think-orbit-a \{\s*animation: cm-think-turn-on-a 460ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/)
  assert.match(client, /\.chat-mode-toggle\[data-turn='on'\] \.cm-think-orbit-b \{\s*animation: cm-think-turn-on-b 400ms cubic-bezier\(0\.22, 1, 0\.36, 1\) 60ms;/)
  // Orbit A turns clockwise with a horizontal flatten, B turns anticlockwise with
  // a vertical flatten, both ending on identity so no permanent tilt remains.
  assert.match(client, /@keyframes cm-think-turn-on-a \{\s*from \{ transform: rotate\(0deg\) scaleX\(1\); \}\s*50% \{ transform: rotate\(90deg\) scaleX\(0\.72\); \}\s*to \{ transform: rotate\(180deg\) scaleX\(1\); \}/)
  assert.match(client, /@keyframes cm-think-turn-on-b \{\s*from \{ transform: rotate\(0deg\) scaleY\(1\); \}\s*50% \{ transform: rotate\(-90deg\) scaleY\(0\.72\); \}\s*to \{ transform: rotate\(-180deg\) scaleY\(1\); \}/)
  // The core pulses instead of orbiting.
  assert.match(client, /@keyframes cm-think-core-pulse \{\s*0% \{ transform: scale\(1\); \}\s*45% \{ transform: scale\(1\.18\); \}\s*100% \{ transform: scale\(1\); \}/)
  assert.match(client, /\[data-turn='on'\] \.cm-think-core \{\s*animation: cm-think-core-pulse 460ms/)
  // One-shot only: no fill mode pinning the last frame and no looping.
  assert.doesNotMatch(client, /animation-fill-mode|animation: [^;]*infinite|infinite/)
})

test('turn off runs the same orbits backwards', () => {
  assert.match(client, /\.chat-mode-toggle\[data-turn='off'\] \.cm-think-orbit-a \{\s*animation: cm-think-turn-off-a 420ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/)
  assert.match(client, /\.chat-mode-toggle\[data-turn='off'\] \.cm-think-orbit-b \{\s*animation: cm-think-turn-off-b 360ms cubic-bezier\(0\.22, 1, 0\.36, 1\) 60ms;/)
  assert.match(client, /@keyframes cm-think-turn-off-a \{\s*from \{ transform: rotate\(0deg\) scaleX\(1\); \}\s*50% \{ transform: rotate\(-90deg\) scaleX\(0\.72\); \}\s*to \{ transform: rotate\(-180deg\) scaleX\(1\); \}/)
  assert.match(client, /@keyframes cm-think-turn-off-b \{\s*from \{ transform: rotate\(0deg\) scaleY\(1\); \}\s*50% \{ transform: rotate\(90deg\) scaleY\(0\.72\); \}\s*to \{ transform: rotate\(180deg\) scaleY\(1\); \}/)
  // Off must not re-trigger the switch-on core pulse.
  assert.doesNotMatch(client, /\[data-turn='off'\] \.cm-think-core \{\s*animation/)
})

test('the globe meridians slide inside the clipPath while the ring stays still', () => {
  assert.equal((client.match(/dsh-chat-globe-clip/g) ?? []).length, 1, 'the clip id must be declared once')
  assert.match(client, /const GLOBE_CLIP_ID = 'dsh-chat-globe-clip'/)
  assert.match(client, /createElement\(\s*'clipPath',\s*\{ id: GLOBE_CLIP_ID \}/)
  assert.match(client, /className: 'cm-globe-meridians', clipPath: `url\(#\$\{GLOBE_CLIP_ID\}\)`/)
  // Two to three curved meridians inside the clipped group.
  const clipped = /className: 'cm-globe-meridians', clipPath: `url\(#\$\{GLOBE_CLIP_ID\}\)` \},([\s\S]*?)\),\s*React\.createElement\('circle'/.exec(client)
  assert.ok(clipped, 'the clipped meridian group must precede the static ring')
  assert.ok((clipped[1].match(/createElement\('path'/g) ?? []).length >= 2, 'at least two meridians')
  // Only the meridian group is animated; the static ring and equator are not.
  assert.match(client, /\.chat-mode-toggle\[data-turn='on'\] \.cm-globe-meridians \{\s*animation: cm-globe-turn-on 480ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/)
  assert.match(client, /\.chat-mode-toggle\[data-turn='off'\] \.cm-globe-meridians \{\s*animation: cm-globe-turn-off 440ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/)
  assert.match(client, /@keyframes cm-globe-turn-on \{\s*from \{ transform: translateX\(-2\.4px\) scaleX\(0\.9\); \}\s*to \{ transform: translateX\(0\) scaleX\(1\); \}/)
  assert.match(client, /@keyframes cm-globe-turn-off \{\s*from \{ transform: translateX\(2\.4px\) scaleX\(1\); \}\s*to \{ transform: translateX\(0\) scaleX\(1\); \}/)
  assert.match(client, /\.cm-globe-meridians \{\s*transform-box: fill-box;\s*transform-origin: center;/)
  assert.doesNotMatch(client, /\[data-turn\] \.chat-mode-globe \{\s*animation/)
})

test('the direction marker only fires on a real state change', () => {
  // data-turn is written from the hook's one-shot marker, never from aria-pressed.
  assert.match(client, /'data-turn': props\.turn === 'turn-on' \? 'on' : props\.turn === 'turn-off' \? 'off' : undefined/)
  assert.match(client, /function useTurnAnimation\(active, kind\) \{/)
  assert.match(client, /const previous = React\.useRef\(active\)/)
  assert.match(client, /if \(previous\.current === active\) return/)
  assert.match(client, /previous\.current = active\s*setTurn\(active \? 'turn-on' : 'turn-off'\)/)
  // Both directions use the same marker, so a repeat activation needs the key.
  assert.match(client, /setSequence\(\(count\) => count \+ 1\)/)
  assert.match(client, /iconKey: `\$\{kind\}-\$\{sequence\}`/)
  assert.match(client, /key: props\.iconKey/)
  // The window clears the marker again: 500/520 on, 460/480 off.
  assert.match(client, /turn === 'turn-on'\s*\? \(kind === 'think' \? 500 : 520\)/)
  assert.match(client, /: \(kind === 'think' \? 460 : 480\)/)
  assert.match(client, /setTimeout\(\(\) => setTurn\(null\), duration\)/)
  // Each icon owns its own instance of the state machine.
  assert.match(client, /const thinkTurn = useTurnAnimation\(thinking, 'think'\)/)
  assert.match(client, /const webTurn = useTurnAnimation\(web, 'web'\)/)
  // The old whole-svg spin machine must be gone.
  assert.doesNotMatch(client, /useActivationSpin|data-spin|chat-mode-spin/)
})

test('a running web command never disables the pill', () => {
  assert.match(client, /cursor: pointer/)
  assert.doesNotMatch(client, /cursor: not-allowed/)
  assert.doesNotMatch(client, /button\.chat-mode-toggle:disabled\s*\{/)
  // The Toggle component must not receive a disabled attribute at all.
  assert.doesNotMatch(client, /\bdisabled: (?:true|busy)/)
  assert.doesNotMatch(client, /aria-disabled/)
})

test('the web toggle flips before it awaits and rolls back on failure', () => {
  const start = client.indexOf('const toggleWeb = React.useCallback')
  const end = client.indexOf('}, [mute, props, web])', start)
  assert.ok(start >= 0 && end > start, 'toggleWeb must exist')
  const body = client.slice(start, end)
  // The press state moves before the command leaves.
  assert.match(body, /if \(inFlight\.current\) return/)
  assert.match(body, /inFlight\.current = true/)
  assert.match(body, /const previous = web/)
  assert.match(body, /const next = !web/)
  assert.ok(body.indexOf('setWeb(next)') !== -1, 'optimistic flip must exist')
  assert.ok(
    body.indexOf('setWeb(next)') < body.indexOf('await props.runCommand'),
    'the flip must happen before the await',
  )
  // Only a success is remembered; a failure restores the previous value.
  assert.match(body, /await props\.runCommand\(next \? '\/web on' : '\/web off'\)/)
  assert.match(body, /props\.rememberWeb\(props\.sessionId, next\)/)
  assert.ok(body.indexOf('props.rememberWeb') > body.indexOf('await props.runCommand'))
  const catchBlock = body.slice(body.indexOf('} catch {'))
  assert.match(catchBlock, /setWeb\(previous\)/)
  assert.match(catchBlock, /mute\('web', false\)/)
  // The lock is released whatever happens.
  assert.match(body, /\} finally \{\s*inFlight\.current = false/)
})

test('the tooltip is the dark web bubble in both themes', () => {
  assert.match(client, /--cm-tip-bg: #1f2329/)
  assert.match(client, /--cm-tip-text: #ffffff/)
  assert.match(client, /--cm-tip-border: rgba\(255, 255, 255, 0\.08\)/)
  assert.match(client, /border-radius: 8px/)
  assert.match(client, /box-shadow: 0 10px 28px rgba\(0, 0, 0, 0\.32\)/)
  // The old light bubble colours are gone; dark theme inherits the same bubble.
  assert.doesNotMatch(client, /--cm-tip-bg: #ffffff/)
  assert.doesNotMatch(client, /--cm-tip-bg: #23262d/)
  assert.doesNotMatch(client, /--cm-tip-text: #(?:1f2329|23262d)/)
})

test('reduced motion disables every icon animation', () => {
  const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(client)
  assert.ok(block, 'the reduced motion guard must exist')
  for (const selector of ['.chat-mode-icon', '.cm-think-orbit', '.cm-think-core', '.cm-globe-meridians']) {
    assert.ok(block[1].includes(selector), `${selector} must be covered by the guard`)
  }
  assert.match(block[1], /transition: none !important/)
  assert.match(block[1], /animation: none !important/)
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
  assert.match(client, /border: 1px solid var\(--cm-tip-border\)/)
})