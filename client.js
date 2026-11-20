/**
 * Browser half of dsh-plugin-chat-mode.
 *
 * Registers the two composer toggles that mirror the DeepSeek web UI:
 * thinking (off <-> high) and web search (off <-> on). The thinking toggle
 * reads and writes the same per-session model directory the composer's model
 * seat uses, so the button, the seat and `/think` stay in sync. The web toggle
 * runs the local `/web` command, which is answered on the Host without any
 * model request.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-chat-mode',
  factory(require) {
    const React = require('react')

    const CHAT_PRESET = 'chat'

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

    const BASE = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      height: '26px',
      padding: '0 8px',
      borderRadius: '8px',
      border: '1px solid var(--dsh-border, rgba(127,127,127,0.28))',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      fontSize: '12px',
      lineHeight: 1,
      cursor: 'pointer',
    }

    const ON = {
      background: 'var(--dsh-accent-soft, rgba(77,107,254,0.14))',
      borderColor: 'var(--dsh-accent, #4d6bfe)',
      color: 'var(--dsh-accent, #4d6bfe)',
    }

    /** One toggle button; `active` paints the on state, `title` carries the detail. */
    function Toggle(props) {
      const style = props.active ? Object.assign({}, BASE, ON) : BASE
      return React.createElement(
        'button',
        {
          type: 'button',
          className: props.className,
          style,
          title: props.title,
          'aria-pressed': props.active,
          onClick: props.onClick,
        },
        props.children,
      )
    }

    /** The two toggles, hidden unless this session runs the chat preset. */
    function ChatToggles(props) {
      const preset = useSnapshot(props.presetStore)
      const directory = useSnapshot(props.directoryStore)
      const [web, setWeb] = React.useState(() => props.webState.get(props.sessionId) === true)
      const [busy, setBusy] = React.useState(false)

      const effort = directory.current?.reasoningEffort
      const thinking = effort !== undefined && effort !== 'auto' && effort !== 'off'
      const thinkingTitle = thinking
        ? label(`深度思考：开启（${effort === undefined ? 'high' : effort}）`, `Deep thinking: on (${effort ?? 'high'})`)
        : label('深度思考：关闭', 'Deep thinking: off')

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
        { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } },
        React.createElement(
          Toggle,
          { active: thinking, title: thinkingTitle, onClick: toggleThinking, className: 'chat-toggle-thinking' },
          React.createElement('span', { 'aria-hidden': true }, '\u{1F9E0}'),
          React.createElement('span', null, label('深度思考', 'Think')),
        ),
        React.createElement(
          Toggle,
          {
            active: web,
            title: web
              ? label('联网搜索：开启（只计模型 token）', 'Web search: on (model tokens only)')
              : label('联网搜索：关闭', 'Web search: off'),
            onClick: toggleWeb,
            className: 'chat-toggle-web',
          },
          React.createElement('span', { 'aria-hidden': true }, '\u{1F310}'),
          React.createElement('span', null, label('联网', 'Web')),
        ),
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
                    if (event && event.sessionId !== undefined && event.name !== undefined) {
                      if (event.name === 'web' || event.name === 'chat') listener(event.sessionId)
                    }
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
