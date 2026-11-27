/**
 * Browser half of dsh-plugin-chat-mode.
 *
 * Registers the two composer toggles that mirror the DeepSeek web UI:
 * thinking (off <-> high) and web search (off <-> on). The thinking toggle
 * reads and writes the same per-session model directory the composer's model
 * seat uses, so the button, the seat and `/think` stay in sync. The web toggle
 * runs the local `/web` command, which is answered on the Host without any
 * model request.
 *
 * Visuals follow DeepSeek's open-source chat front end,
 * https://github.com/deepseek-ai/chat-demo (MIT, Copyright (c) 2026 DeepSeek):
 * the toggle geometry, the selected/hover treatment and the 14px outline
 * vocabulary come from `src/components/chatInput/ChatInput.module.css` and
 * `src/components/base/icons.tsx` in that repository; the two glyphs below are
 * now composed as layered, independently animated parts. See NOTICE.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-chat-mode',
  factory(require) {
    const React = require('react')

    const CHAT_PRESET = 'chat'
    const STYLE_ID = 'chat-mode-toggles-styles'

    /**
     * One stylesheet for both toggles.
     *
     * Geometry and the selected/hover treatment follow chat-demo exactly:
     * 34px tall, 18px radius, 13px/20px medium label, a 1px light border when
     * off and DeepSeek blue when on. Neutrals come from DSH theme tokens; the
     * accent cannot, because `--dsw-alias-brand-primary` is the near-black
     * wordmark color rather than the UI blue, so the blue is pinned here and
     * the container switches palette by the detected theme (light/dark).
     *
     * On the light theme the label is #3555e0 rather than the #4d6bfe accent:
     * #4d6bfe on the 0.10 ice-blue fill measures ~3.7:1, below WCAG AA's
     * 4.5:1 for 13px text, while #3555e0 measures ~5.2:1 on the same fill. The
     * accent still paints the border; the dark theme keeps its #7c97ff pair.
     *
     * The tooltip is the web client's dark bubble in both themes, so it does
     * not use the host's tooltip tokens.
     */
    const STYLES = `
.chat-mode-toggles {
  --cm-accent: #4d6bfe;
  --cm-label: #3555e0;
  --cm-border: rgba(15, 17, 20, 0.14);
  --cm-soft: rgba(77, 107, 254, 0.10);
  --cm-soft: color-mix(in srgb, var(--cm-accent) 10%, transparent);
  --cm-soft-hover: rgba(77, 107, 254, 0.18);
  --cm-soft-hover: color-mix(in srgb, var(--cm-accent) 18%, transparent);
  --cm-hover: rgba(15, 17, 20, 0.06);
  --cm-glow: rgba(77, 107, 254, 0.22);
  --cm-focus: rgba(77, 107, 254, 0.25);
  --cm-tip-bg: #1f2329;
  --cm-tip-border: rgba(255, 255, 255, 0.08);
  --cm-tip-text: #ffffff;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.chat-mode-toggles[data-theme='dark'] {
  --cm-accent: #7c97ff;
  --cm-label: #a0b4ff;
  --cm-border: rgba(255, 255, 255, 0.18);
  --cm-soft: rgba(124, 151, 255, 0.16);
  --cm-soft: color-mix(in srgb, var(--cm-accent) 16%, transparent);
  --cm-soft-hover: rgba(124, 151, 255, 0.24);
  --cm-soft-hover: color-mix(in srgb, var(--cm-accent) 24%, transparent);
  --cm-hover: rgba(255, 255, 255, 0.08);
  --cm-glow: rgba(124, 151, 255, 0.28);
  --cm-focus: rgba(124, 151, 255, 0.32);
}
/*
 * Selectors are deliberately container-scoped and doubled (element + class) so
 * the Electron host's own button reset cannot repaint a square black border
 * or an outline on top of the pill: every border/outline/appearance property is
 * declared here explicitly with the same or higher specificity.
 */
.chat-mode-toggles button.chat-mode-toggle {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 34px;
  margin: 0;
  padding: 0 12px;
  border-radius: 18px;
  border-style: solid;
  border-width: 1px;
  border-color: var(--cm-border);
  appearance: none;
  -webkit-appearance: none;
  background-color: transparent;
  background-image: none;
  box-shadow: none;
  color: var(--dsw-alias-label-secondary, #4a4f57);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  outline: none;
  transition:
    background-color 180ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 180ms cubic-bezier(0.4, 0, 0.2, 1),
    color 180ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 180ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.chat-mode-toggles button.chat-mode-toggle::-moz-focus-inner {
  border: 0;
  padding: 0;
}
.chat-mode-toggles button.chat-mode-toggle:hover {
  background-color: var(--cm-hover);
}
.chat-mode-toggles button.chat-mode-toggle:active {
  transform: scale(0.96);
  transition-duration: 100ms;
}
/* A mouse click must never leave a square outline; only keyboard focus gets one. */
.chat-mode-toggles button.chat-mode-toggle:focus {
  outline: none;
  box-shadow: none;
}
.chat-mode-toggles button.chat-mode-toggle:focus-visible {
  outline: none;
  border-color: var(--cm-accent);
  box-shadow: 0 0 0 2px var(--cm-focus);
}
.chat-mode-toggles button.chat-mode-toggle[aria-pressed='true'] {
  background-color: var(--cm-soft);
  border-color: var(--cm-accent);
  color: var(--cm-label);
  box-shadow: none;
}
.chat-mode-toggles button.chat-mode-toggle[aria-pressed='true']:hover {
  background-color: var(--cm-soft-hover);
}
/*
 * One-shot activation motion.
 *
 * data-turn is the direction marker written only for the render that follows
 * a state change ('on' for off -> on, 'off' for on -> off) and removed again
 * once the window closes, so every animation below runs exactly once, never
 * loops, and never hangs off the resting [aria-pressed] state. Each icon part
 * animates on its own layer; the <svg> itself never rotates as a whole.
 */
.chat-mode-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  transform-origin: center;
  transform-box: fill-box;
}
.chat-mode-icon svg {
  display: block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
/* Layered atom: two elliptical orbits and a fixed centre core. */
.cm-think-orbit,
.cm-think-core {
  transform-box: fill-box;
  transform-origin: center;
}
.chat-mode-toggle[data-turn='on'] .cm-think-orbit-a {
  animation: cm-think-turn-on-a 460ms cubic-bezier(0.22, 1, 0.36, 1);
}
.chat-mode-toggle[data-turn='on'] .cm-think-orbit-b {
  animation: cm-think-turn-on-b 400ms cubic-bezier(0.22, 1, 0.36, 1) 60ms;
}
.chat-mode-toggle[data-turn='on'] .cm-think-core {
  animation: cm-think-core-pulse 460ms cubic-bezier(0.22, 1, 0.36, 1);
}
.chat-mode-toggle[data-turn='off'] .cm-think-orbit-a {
  animation: cm-think-turn-off-a 420ms cubic-bezier(0.22, 1, 0.36, 1);
}
.chat-mode-toggle[data-turn='off'] .cm-think-orbit-b {
  animation: cm-think-turn-off-b 360ms cubic-bezier(0.22, 1, 0.36, 1) 60ms;
}
/*
 * Turn on: the two orbits sweep in opposite directions while a scale on the
 * other axis fakes a 3D flatten, then settle back to the flat resting pose.
 * The final frame is a half turn, which a symmetric ellipse shows as identity,
 * and the animation has no fill mode, so the element rests untransformed.
 */
@keyframes cm-think-turn-on-a {
  from { transform: rotate(0deg) scaleX(1); }
  50% { transform: rotate(90deg) scaleX(0.72); }
  to { transform: rotate(180deg) scaleX(1); }
}
@keyframes cm-think-turn-on-b {
  from { transform: rotate(0deg) scaleY(1); }
  50% { transform: rotate(-90deg) scaleY(0.72); }
  to { transform: rotate(-180deg) scaleY(1); }
}
/* Turn off: the same two orbits, reversed, with the mirrored delay. */
@keyframes cm-think-turn-off-a {
  from { transform: rotate(0deg) scaleX(1); }
  50% { transform: rotate(-90deg) scaleX(0.72); }
  to { transform: rotate(-180deg) scaleX(1); }
}
@keyframes cm-think-turn-off-b {
  from { transform: rotate(0deg) scaleY(1); }
  50% { transform: rotate(90deg) scaleY(0.72); }
  to { transform: rotate(180deg) scaleY(1); }
}
/* The core breathes, never orbits. */
@keyframes cm-think-core-pulse {
  0% { transform: scale(1); }
  45% { transform: scale(1.18); }
  100% { transform: scale(1); }
}
/*
 * Globe: only the curves inside the clipPath move. The outer ring and the
 * equator are separate, static elements, so they never rotate.
 */
.cm-globe-meridians {
  transform-box: fill-box;
  transform-origin: center;
}
.chat-mode-toggle[data-turn='on'] .cm-globe-meridians {
  animation: cm-globe-turn-on 480ms cubic-bezier(0.22, 1, 0.36, 1);
}
.chat-mode-toggle[data-turn='off'] .cm-globe-meridians {
  animation: cm-globe-turn-off 440ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes cm-globe-turn-on {
  from { transform: translateX(-2.4px) scaleX(0.9); }
  to { transform: translateX(0) scaleX(1); }
}
@keyframes cm-globe-turn-off {
  from { transform: translateX(2.4px) scaleX(1); }
  to { transform: translateX(0) scaleX(1); }
}
.chat-mode-toggles .chat-mode-toggle::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 4;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--cm-tip-border);
  background-color: var(--cm-tip-bg);
  color: var(--cm-tip-text);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
  font-size: 12px;
  line-height: 18px;
  font-weight: 400;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, 4px);
  transition: opacity 160ms ease, transform 160ms ease;
  transition-delay: 0ms;
}
.chat-mode-toggles .chat-mode-toggle:hover::after {
  opacity: 1;
  transform: translate(-50%, 0);
  transition-delay: 380ms;
}
.chat-mode-toggles .chat-mode-toggle:active::after,
.chat-mode-toggles .chat-mode-toggle:focus-visible::after {
  opacity: 0;
  transform: translate(-50%, 4px);
  transition-delay: 0ms;
}
/*
 * After a click the bubble stays suppressed until the pointer leaves the
 * button, so it never hangs over the composer while the user keeps working.
 */
.chat-mode-toggles .chat-mode-toggle[data-tooltip-muted='true']::after {
  content: none;
}
/*
 * No :disabled rules on purpose. A running /web command keeps the button
 * fully interactive (optimistic state + a ref lock in JS), so the platform's
 * not-allowed cursor can never appear over it.
 */
@media (prefers-reduced-motion: reduce) {
  .chat-mode-toggles button.chat-mode-toggle,
  .chat-mode-toggles button.chat-mode-toggle::after,
  .chat-mode-toggle .chat-mode-icon,
  .chat-mode-toggle .chat-mode-icon svg,
  .chat-mode-toggle .cm-think-orbit,
  .chat-mode-toggle .cm-think-core,
  .chat-mode-toggle .cm-globe-meridians {
    transition: none !important;
    animation: none !important;
  }
  .chat-mode-toggles button.chat-mode-toggle:active {
    transform: none;
  }
}
`

    /** Read one snapshot store through React's external-store contract. */
    function useSnapshot(store) {
      return React.useSyncExternalStore(
        (listener) => store.subscribe(listener),
        () => store.getSnapshot(),
      )
    }

    /** Localized label without depending on a locale namespace of our own. */
    function label(zh, en) {
      return typeof navigator !== 'undefined' && /^zh/i.test(navigator.language ?? '') ? zh : en
    }

    /**
     * Light or dark, decided from the host's own base background. The host
     * switches themes by swapping CSS variables, so the resolved color is the
     * only reliable signal and it works for a manual toggle as well as the
     * system preference.
     */
    function detectTheme() {
      try {
        const probe = document.createElement('div')
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;'
          + 'background-color:var(--dsw-alias-bg-base,#ffffff)'
        document.body.appendChild(probe)
        const value = getComputedStyle(probe).backgroundColor
        probe.remove()
        const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value)
        if (match === null) return 'light'
        const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number(part) / 255)
        const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        return luminance < 0.4 ? 'dark' : 'light'
      } catch {
        return 'light'
      }
    }

    /** Install the stylesheet once per page. */
    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLES
      document.head.appendChild(style)
    }

    /**
     * 14px "think" glyph, rebuilt as a layered atom: two tilted elliptical
     * orbits plus a fixed centre core. Every part is its own group, so the CSS
     * animates the layers independently and the <svg> itself never rotates.
     * The 14px outline vocabulary is still adapted from chat-demo's
     * IconThinkOutline14.
     */
    function ThinkIcon() {
      return React.createElement(
        'svg',
        { viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true, focusable: 'false' },
        React.createElement(
          'g',
          { className: 'cm-think-orbit cm-think-orbit-a' },
          React.createElement('ellipse', {
            cx: 7,
            cy: 7,
            rx: 6,
            ry: 2.6,
            transform: 'rotate(45 7 7)',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            fill: 'none',
          }),
        ),
        React.createElement(
          'g',
          { className: 'cm-think-orbit cm-think-orbit-b' },
          React.createElement('ellipse', {
            cx: 7,
            cy: 7,
            rx: 6,
            ry: 2.6,
            transform: 'rotate(-45 7 7)',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            fill: 'none',
          }),
        ),
        React.createElement('circle', {
          className: 'cm-think-core',
          cx: 7,
          cy: 7,
          r: 1.15,
          fill: 'currentColor',
        }),
      )
    }

    /**
     * Fixed clip id for the globe meridians. Only one globe toggle mounts per
     * page (the composer renders a single chat-mode slot), so a constant id is
     * enough and avoids useId inside this classic script.
     */
    const GLOBE_CLIP_ID = 'dsh-chat-globe-clip'

    /**
     * 14px outline globe: a static ring and equator, with three curved
     * meridians inside a clipPath so only the curves move on activation. The
     * 14px outline vocabulary is adapted from chat-demo's
     * IconGlobeLanguageOutline14.
     */
    function GlobeIcon() {
      const meridian = {
        stroke: 'currentColor',
        strokeWidth: 1.2,
        fill: 'none',
      }
      return React.createElement(
        'svg',
        { viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true, focusable: 'false' },
        React.createElement(
          'defs',
          null,
          React.createElement(
            'clipPath',
            { id: GLOBE_CLIP_ID },
            React.createElement('circle', { cx: 7, cy: 7, r: 6.4 }),
          ),
        ),
        React.createElement(
          'g',
          { className: 'cm-globe-meridians', clipPath: `url(#${GLOBE_CLIP_ID})` },
          React.createElement('path', { d: 'M7 0.9 C 4.6 3, 4.6 11, 7 13.1', ...meridian }),
          React.createElement('path', { d: 'M7 0.9 C 9.4 3, 9.4 11, 7 13.1', ...meridian }),
          React.createElement('path', { d: 'M7 0.9 C 7 3.5, 7 10.5, 7 13.1', ...meridian }),
        ),
        React.createElement('circle', {
          cx: 7,
          cy: 7,
          r: 6.4,
          stroke: 'currentColor',
          strokeWidth: 1.2,
          fill: 'none',
        }),
        React.createElement('line', {
          x1: 0.6,
          y1: 7,
          x2: 13.4,
          y2: 7,
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
      )
    }

    /**
     * One toggle button. `active` paints the on state, `tooltip` feeds the
     * delayed CSS bubble (no native `title`, whose black popup appears at 0ms),
     * `turn` is the one-shot direction marker ('turn-on' | 'turn-off' | null)
     * and `muted` keeps the bubble away after a click until the pointer leaves.
     *
     * There is deliberately no `disabled` state: an in-flight command must not
     * grey the button out or swap in a 🚫 cursor, so the press state is driven
     * optimistically and double submits are stopped by a ref lock in JS.
     */
    function Toggle(props) {
      return React.createElement(
        'button',
        {
          type: 'button',
          className: props.className,
          'data-tooltip': props.tooltip,
          'data-tooltip-muted': props.muted === true ? 'true' : 'false',
          'data-turn': props.turn === 'turn-on' ? 'on' : props.turn === 'turn-off' ? 'off' : undefined,
          'aria-description': props.tooltip,
          'aria-pressed': props.active,
          onClick: props.onClick,
          onPointerDown: props.onPointerDown,
          onPointerLeave: props.onPointerLeave,
          onBlur: props.onBlur,
        },
        React.createElement('span', { className: 'chat-mode-icon', key: props.iconKey }, props.icon),
        React.createElement('span', null, props.label),
      )
    }

    /**
     * One-shot direction state machine.
     *
     * `previous` starts at the first value, so the first render (and any plain
     * re-render: theme change, store update, parent render) can never animate.
     * Only off -> on yields 'turn-on' and only on -> off yields 'turn-off'. The
     * marker is cleared after the animation window, which makes it a one-shot
     * marker instead of a looping state; the sequence number keys the icon
     * wrapper so a repeat activation restarts the CSS animation even though the
     * marker value repeats.
     */
    function useTurnAnimation(active, kind) {
      const previous = React.useRef(active)
      const [turn, setTurn] = React.useState(null)
      const [sequence, setSequence] = React.useState(0)

      React.useEffect(() => {
        if (previous.current === active) return
        previous.current = active
        setTurn(active ? 'turn-on' : 'turn-off')
        setSequence((count) => count + 1)
      }, [active])

      React.useEffect(() => {
        if (turn === null) return undefined
        const duration = turn === 'turn-on'
          ? (kind === 'think' ? 500 : 520)
          : (kind === 'think' ? 460 : 480)
        const timer = setTimeout(() => setTurn(null), duration)
        return () => clearTimeout(timer)
      }, [turn, sequence, kind])

      return { turn, iconKey: `${kind}-${sequence}` }
    }

    /** The two toggles, hidden unless this session runs the chat preset. */
    function ChatToggles(props) {
      const preset = useSnapshot(props.presetStore)
      const directory = useSnapshot(props.directoryStore)
      const [web, setWeb] = React.useState(() => props.webState.get(props.sessionId) === true)
      const [theme, setTheme] = React.useState(() => detectTheme())
      const [muted, setMuted] = React.useState({ think: false, web: false })
      // A ref, not state: it must already be true for a second click in the
      // same tick, and a busy render must never turn the button into a
      // disabled control.
      const inFlight = React.useRef(false)

      const mute = React.useCallback((key, value) => {
        setMuted((current) => (current[key] === value ? current : { ...current, [key]: value }))
      }, [])

      const effort = directory.current?.reasoningEffort
      const thinking = effort !== undefined && effort !== 'auto' && effort !== 'off'
      const thinkTurn = useTurnAnimation(thinking, 'think')
      const webTurn = useTurnAnimation(web, 'web')

      const toggleThinking = React.useCallback(async () => {
        const current = props.directoryStore.getSnapshot().current
        if (current === null) return
        const next = thinking ? 'off' : 'high'
        try {
          await props.select({ provider: current.provider, model: current.model, reasoningEffort: next })
        } catch {
          /* the model seat surfaces its own failure toast */
        }
      }, [props, thinking])

      /**
       * Optimistic web toggle.
       *
       * The pressed state flips before the command is sent, so the button never
       * looks stuck behind the command round trip. A failed command rolls the
       * visual state back to the previous value, re-arms the tooltip and leaves
       * the remembered value untouched (it is only written on success).
       */
      const toggleWeb = React.useCallback(async () => {
        if (inFlight.current) return
        inFlight.current = true
        const previous = web
        const next = !web
        setWeb(next)
        try {
          await props.runCommand(next ? '/web on' : '/web off')
          props.rememberWeb(props.sessionId, next)
        } catch {
          // Command failures surface in the transcript; the button must not
          // stay stuck in a state the Host rejected.
          setWeb(previous)
          mute('web', false)
        } finally {
          inFlight.current = false
        }
      }, [mute, props, web])

      React.useEffect(() => {
        ensureStyles()
        const sync = () => setTheme(detectTheme())
        sync()
        const observer = new MutationObserver(sync)
        observer.observe(document.documentElement, { attributes: true })
        observer.observe(document.body, { attributes: true })
        return () => observer.disconnect()
      }, [])

      React.useEffect(() => {
        const off = props.subscribeExecuted((sessionId) => {
          if (sessionId !== props.sessionId) return
          setWeb(props.webState.get(sessionId) === true)
        })
        const remembered = props.rememberedWeb(props.sessionId)
        if (typeof remembered === 'boolean') setWeb(remembered)
        return off
      }, [props])

      if (preset !== CHAT_PRESET) return null

      return React.createElement(
        'div',
        { className: 'chat-mode-toggles', 'data-theme': theme },
        React.createElement(Toggle, {
          active: thinking,
          tooltip: label('先思考后回答，解决推理问题', 'Think before answering to solve reasoning tasks'),
          onClick: toggleThinking,
          onPointerDown: () => mute('think', true),
          onPointerLeave: () => mute('think', false),
          onBlur: () => mute('think', false),
          muted: muted.think,
          turn: thinkTurn.turn,
          iconKey: thinkTurn.iconKey,
          className: 'chat-mode-toggle chat-toggle-thinking',
          icon: React.createElement(ThinkIcon, null),
          label: label('深度思考', 'DeepThink'),
        }),
        React.createElement(Toggle, {
          active: web,
          tooltip: label('按需搜索网页', 'Search the web as needed'),
          onClick: toggleWeb,
          onPointerDown: () => mute('web', true),
          onPointerLeave: () => mute('web', false),
          onBlur: () => mute('web', false),
          muted: muted.web,
          turn: webTurn.turn,
          iconKey: webTurn.iconKey,
          className: 'chat-mode-toggle chat-toggle-web',
          icon: React.createElement(GlobeIcon, null),
          label: label('联网搜索', 'Search'),
        }),
      )
    }

    return {
      inject: ['slots', 'sessions', 'modelDirectories', 'remote', 'remote.commands'],
      apply(ctx) {
        const webState = new Map()
        const sessions = ctx.get('sessions')
        const directories = ctx.get('modelDirectories')
        const remote = ctx.get('remote')

        /**
         * Seed the web state from this browser's own memory. The Host state is
         * authoritative, but reading it would cost a visible command round trip;
         * every change (our button, a typed /web or /chat) updates this cache.
         */
        const rememberedWeb = (sessionId) => {
          try {
            const raw = window.localStorage.getItem(`chat-mode:web:${sessionId}`)
            return raw === 'on' ? true : raw === 'off' ? false : undefined
          } catch {
            return undefined
          }
        }
        const rememberWeb = (sessionId, value) => {
          webState.set(sessionId, value)
          try {
            window.localStorage.setItem(`chat-mode:web:${sessionId}`, value ? 'on' : 'off')
          } catch { /* private mode */ }
        }

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'chat-mode-toggles',
          order: 30,
          inject: (sessionId) => {
            const binding = sessions.binding(sessionId)
            const directory = directories.directoryFor(sessionId)
            return {
              sessionId,
              webState,
              directoryStore: directory.store,
              presetStore: binding.session.projections.faceOf('agentPreset'),
              select: (selection) => directory.select(selection),
              runCommand: (line) => remote.commands.execute(sessionId, line, []),
              rememberedWeb,
              rememberWeb,
              subscribeExecuted: (listener) => {
                const handler = (event) => {
                  try {
                    if (!event || event.sessionId === undefined || event.name === undefined) return
                    if (event.name === 'web') {
                      // A typed /web on|off runs on the Host; the receipt is the
                      // only signal the client gets, so mirror it into the cache.
                      const text = typeof event.result?.text === 'string' ? event.result.text : ''
                      const on = /已开启|: on\b|开启/i.test(text)
                      const off = /已关闭|: off\b|关闭/i.test(text)
                      if (on && !off) rememberWeb(event.sessionId, true)
                      else if (off && !on) rememberWeb(event.sessionId, false)
                    }
                    if (event.name === 'web' || event.name === 'chat') listener(event.sessionId)
                  } catch { /* never break other listeners */ }
                }
                return ctx.on('command/executed', handler)
              },
            }
          },
        }, ChatToggles))
      },
    }
  },
})
