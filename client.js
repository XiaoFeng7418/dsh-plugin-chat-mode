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
 * the toggle geometry, the selected/hover treatment and the two 14px outline
 * icon paths are adapted from `src/components/chatInput/ChatInput.module.css`
 * and `src/components/base/icons.tsx` in that repository. See NOTICE.
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
     */
    const STYLES = `
.chat-mode-toggles {
  --cm-accent: #4d6bfe;
  --cm-label: #3555e0;
  --cm-soft: rgba(77, 107, 254, 0.12);
  --cm-soft: color-mix(in srgb, var(--cm-accent) 12%, transparent);
  --cm-soft-hover: rgba(77, 107, 254, 0.18);
  --cm-soft-hover: color-mix(in srgb, var(--cm-accent) 18%, transparent);
  --cm-hover: rgba(15, 17, 20, 0.06);
  --cm-glow: rgba(77, 107, 254, 0.22);
  --cm-tip-bg: #ffffff;
  --cm-tip-border: rgba(15, 23, 42, 0.08);
  --cm-tip-text: #2b2f36;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.chat-mode-toggles[data-theme='dark'] {
  --cm-accent: #7c97ff;
  --cm-label: #a0b4ff;
  --cm-soft: rgba(124, 151, 255, 0.16);
  --cm-soft: color-mix(in srgb, var(--cm-accent) 20%, transparent);
  --cm-soft-hover: rgba(124, 151, 255, 0.24);
  --cm-soft-hover: color-mix(in srgb, var(--cm-accent) 28%, transparent);
  --cm-hover: rgba(255, 255, 255, 0.08);
  --cm-glow: rgba(124, 151, 255, 0.28);
  --cm-tip-bg: #23262d;
  --cm-tip-border: rgba(255, 255, 255, 0.10);
  --cm-tip-text: #e8eaef;
}
.chat-mode-toggle {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 34px;
  padding: 0 12px;
  border-radius: 18px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.32));
  background-color: transparent;
  color: var(--dsw-alias-label-secondary, #4a4f57);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  outline: none;
  transition:
    background-color 180ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 180ms cubic-bezier(0.4, 0, 0.2, 1),
    color 180ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 180ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.chat-mode-toggle:hover:not(:disabled) {
  background-color: var(--cm-hover);
}
.chat-mode-toggle:active:not(:disabled) {
  transform: scale(0.95);
  transition-duration: 100ms;
}
.chat-mode-toggle:focus-visible {
  box-shadow: 0 0 0 3px var(--cm-glow);
}
.chat-mode-toggle[aria-pressed='true'] {
  background-color: var(--cm-soft);
  border-color: var(--cm-accent);
  color: var(--cm-label);
  box-shadow: 0 0 0 2px var(--cm-glow);
}
.chat-mode-toggle[aria-pressed='true']:hover:not(:disabled) {
  background-color: var(--cm-soft-hover);
}
.chat-mode-toggle[aria-pressed='true'] svg {
  animation: chat-mode-icon-pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes chat-mode-icon-pop {
  0% { transform: scale(0.72) rotate(-8deg); opacity: 0.6; }
  60% { transform: scale(1.08) rotate(2deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
.chat-mode-toggle::after {
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
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
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
.chat-mode-toggle:hover::after {
  opacity: 1;
  transform: translate(-50%, 0);
  transition-delay: 380ms;
}
.chat-mode-toggle:active::after,
.chat-mode-toggle:focus-visible::after {
  opacity: 0;
  transform: translate(-50%, 4px);
  transition-delay: 0ms;
}
.chat-mode-toggle:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.chat-mode-toggle:disabled::after {
  content: none;
}
.chat-mode-toggle svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
@media (prefers-reduced-motion: reduce) {
  .chat-mode-toggle,
  .chat-mode-toggle::after,
  .chat-mode-toggle svg {
    transition: none !important;
    animation: none !important;
  }
  .chat-mode-toggle:active:not(:disabled) {
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
     * 14px outline "think" glyph: a centre dot inside a rounded four-lobe
     * outline. Path data adapted from chat-demo's IconThinkOutline14.
     */
    function ThinkIcon() {
      return React.createElement(
        'svg',
        { viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true, focusable: 'false' },
        React.createElement('path', {
          fill: 'currentColor',
          d: 'M7.06431 5.93342C7.68763 5.93342 8.19307 6.43904 8.19322 7.06233C8.19322 7.68573 7.68772 8.19123 7.06431 8.19123C6.44099 8.19113 5.9354 7.68567 5.9354 7.06233C5.93555 6.43911 6.44108 5.93353 7.06431 5.93342Z',
        }),
        React.createElement('path', {
          fill: 'currentColor',
          fillRule: 'evenodd',
          clipRule: 'evenodd',
          d: 'M8.6815 0.963693C10.1169 0.447019 11.6266 0.374829 12.5633 1.31135C13.5 2.24805 13.4277 3.75776 12.911 5.19319C12.7126 5.74431 12.4386 6.31796 12.0965 6.89729C12.4969 7.54638 12.8141 8.19018 13.036 8.80647C13.5527 10.2419 13.6251 11.7516 12.6883 12.6883C11.7516 13.625 10.242 13.5527 8.8065 13.036C8.19022 12.8141 7.54641 12.4969 6.89732 12.0965C6.31797 12.4386 5.74435 12.7125 5.19322 12.911C3.75777 13.4276 2.2481 13.5 1.31138 12.5633C0.374859 11.6266 0.447049 10.1168 0.963724 8.68147C1.17185 8.10338 1.46321 7.50063 1.82896 6.8924C1.52182 6.35711 1.27235 5.82825 1.08872 5.31819C0.572068 3.88278 0.499714 2.37306 1.43638 1.43635C2.37308 0.499655 3.8828 0.572044 5.31822 1.08869C5.82828 1.27232 6.35715 1.5218 6.89243 1.82893C7.50066 1.46318 8.10341 1.17181 8.6815 0.963693ZM11.3573 8.01154C10.9083 8.62253 10.3901 9.22873 9.80943 9.8094C9.22877 10.3901 8.62255 10.9083 8.01158 11.3572C8.4257 11.5841 8.8287 11.7688 9.21275 11.9071C10.5456 12.3868 11.4246 12.2547 11.8397 11.8397C12.2548 11.4246 12.3869 10.5456 11.9071 9.21272C11.7688 8.82866 11.5841 8.42568 11.3573 8.01154ZM2.56529 8.02912C2.37344 8.39322 2.21495 8.74796 2.09263 9.08772C1.61291 10.4204 1.74512 11.2995 2.16001 11.7147C2.57505 12.1297 3.45415 12.2618 4.78697 11.7821C5.11057 11.6656 5.44786 11.5164 5.7938 11.3367C5.249 10.9223 4.70922 10.4533 4.19029 9.9344C3.57578 9.31987 3.03169 8.67633 2.56529 8.02912ZM6.90708 3.2469C6.24065 3.70479 5.5646 4.26321 4.91392 4.91389C4.26325 5.56456 3.70482 6.24063 3.24693 6.90705C3.72674 7.63325 4.32777 8.37459 5.03892 9.08576C5.64943 9.69627 6.28183 10.2265 6.90806 10.6678C7.59368 10.2025 8.2908 9.63076 8.96079 8.96076C9.6308 8.29075 10.2025 7.59366 10.6678 6.90803C10.2265 6.2818 9.69631 5.6494 9.08579 5.03889C8.37462 4.32773 7.63328 3.72672 6.90708 3.2469ZM11.7147 2.15998C11.2996 1.74509 10.4204 1.61288 9.08775 2.0926C8.74835 2.21479 8.39382 2.37271 8.03013 2.56428C8.67728 3.03065 9.31995 3.5758 9.93443 4.19026C10.4534 4.7092 10.9223 5.24896 11.3368 5.79377C11.5164 5.44785 11.6656 5.11052 11.7821 4.78694C12.2618 3.45416 12.1297 2.57502 11.7147 2.15998ZM4.91197 2.2176C3.57922 1.73788 2.70004 1.86995 2.28501 2.28498C1.87001 2.70003 1.73791 3.5792 2.21763 4.91194C2.31709 5.18822 2.44112 5.47427 2.58677 5.7674C3.01931 5.1887 3.51474 4.6158 4.06529 4.06526C4.61584 3.5147 5.18872 3.01928 5.76743 2.58674C5.47431 2.4411 5.18824 2.31706 4.91197 2.2176Z',
        }),
      )
    }

    /**
     * 14px outline globe: circle plus one meridian and one parallel. Path data
     * adapted from chat-demo's IconGlobeLanguageOutline14.
     */
    function GlobeIcon() {
      return React.createElement(
        'svg',
        { viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true, focusable: 'false' },
        React.createElement('path', {
          fill: 'currentColor',
          fillRule: 'evenodd',
          clipRule: 'evenodd',
          d: 'M7 0.150391C10.7832 0.150391 13.8496 3.21685 13.8496 7C13.8496 10.7832 10.7832 13.8496 7 13.8496C3.21685 13.8496 0.150391 10.7832 0.150391 7C0.150391 3.21685 3.21685 0.150391 7 0.150391ZM5.37793 7.59961C5.42667 9.03204 5.64751 10.2965 5.97363 11.2197C6.15993 11.7471 6.36943 12.1301 6.57324 12.3701C6.77748 12.6105 6.9234 12.6504 7 12.6504C7.0766 12.6504 7.22252 12.6105 7.42676 12.3701C7.63057 12.1301 7.84007 11.7471 8.02637 11.2197C8.35249 10.2965 8.57333 9.03204 8.62207 7.59961H5.37793ZM1.38184 7.59961C1.61453 9.80492 3.1159 11.6304 5.14258 12.3359C5.03265 12.1128 4.93224 11.8724 4.84277 11.6191C4.46339 10.5451 4.22772 9.13988 4.17871 7.59961H1.38184ZM9.82129 7.59961C9.77228 9.13988 9.53661 10.5451 9.15723 11.6191C9.06771 11.8726 8.96645 12.1127 8.85645 12.3359C10.8836 11.6307 12.3854 9.80524 12.6182 7.59961H9.82129ZM7 1.34961C6.9234 1.34961 6.77748 1.38949 6.57324 1.62988C6.36943 1.86988 6.15993 2.25291 5.97363 2.78027C5.64751 3.70351 5.42667 4.96796 5.37793 6.40039H8.62207C8.57333 4.96796 8.35249 3.70351 8.02637 2.78027C7.84007 2.25291 7.63057 1.86988 7.42676 1.62988C7.22252 1.38949 7.0766 1.34961 7 1.34961ZM8.85645 1.66309C8.9666 1.88656 9.0676 2.12715 9.15723 2.38086C9.53661 3.45487 9.77228 4.86012 9.82129 6.40039H12.6182C12.3854 4.19465 10.8837 2.36828 8.85645 1.66309ZM5.14258 1.66309C3.11575 2.3685 1.61454 4.19497 1.38184 6.40039H4.17871C4.22772 4.86012 4.46339 3.45487 4.84277 2.38086C4.93234 2.1273 5.03249 1.88645 5.14258 1.66309Z',
        }),
      )
    }

    /**
     * One toggle button; `active` paints the on state and `tooltip` feeds the
     * delayed CSS bubble (no native `title`, whose black popup appears at 0ms).
     */
    function Toggle(props) {
      return React.createElement(
        'button',
        {
          type: 'button',
          className: props.className,
          'data-tooltip': props.tooltip,
          'aria-description': props.tooltip,
          'aria-pressed': props.active,
          disabled: props.disabled === true,
          onClick: props.onClick,
        },
        props.icon,
        React.createElement('span', null, props.label),
      )
    }

    /** The two toggles, hidden unless this session runs the chat preset. */
    function ChatToggles(props) {
      const preset = useSnapshot(props.presetStore)
      const directory = useSnapshot(props.directoryStore)
      const [web, setWeb] = React.useState(() => props.webState.get(props.sessionId) === true)
      const [busy, setBusy] = React.useState(false)
      const [theme, setTheme] = React.useState(() => detectTheme())

      const effort = directory.current?.reasoningEffort
      const thinking = effort !== undefined && effort !== 'auto' && effort !== 'off'

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

      const toggleWeb = React.useCallback(async () => {
        if (busy) return
        const next = !web
        setBusy(true)
        try {
          await props.runCommand(next ? '/web on' : '/web off')
          props.rememberWeb(props.sessionId, next)
          setWeb(next)
        } catch {
          /* command failures surface in the transcript */
        } finally {
          setBusy(false)
        }
      }, [busy, props, web])

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
          className: 'chat-mode-toggle chat-toggle-thinking',
          icon: React.createElement(ThinkIcon, null),
          label: label('深度思考', 'DeepThink'),
        }),
        React.createElement(Toggle, {
          active: web,
          tooltip: label('按需搜索网页', 'Search the web as needed'),
          onClick: toggleWeb,
          disabled: busy,
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
