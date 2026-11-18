# dsh-plugin-chat-mode

A minimal, **tool-free chat preset** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

It adds a `chat` mode to the mode switcher: no tool schemas, no engineering
workflow prompt, no environment snapshot — just a short conversation-tone system
prompt and a temperature that suits everyday chat. It is meant for the times
when you want to use the API like the DeepSeek web app instead of starting a
coding agent.

## Why

The default presets are built for work. Every request carries dozens of tool
schemas plus a multi-kilobyte system prompt with file-editing discipline,
planning rules and a runtime snapshot of the OS, git state, cwd and file tree.
That is the right trade-off for agent work, and the wrong one for "explain this
paragraph to me":

- tool definitions dominate the prompt even when no tool is ever called;
- the workflow language makes the model sound like a task worker ("当然可以！我很乐意为您解答");
- a chat that never touches the filesystem still pays for the filesystem rules.

This plugin keeps the same harness, session model and UI, and removes the parts
a conversation does not need.

## What it does

- **Zero tools.** The preset declares no `tool-*` rows, and the plugin also masks
  every global tool other plugins register on that agent's scope
  (`tools.restrict`), so the request has no `tools` field at all — not an empty
  array, no field. Without the mask a preset alone cannot unregister tools that
  a deployment-level plugin contributes.
- **No workflow prompt.** One `complete` system-prompt section replaces the
  whole assembly, including the harness identity and every engineering section.
- **No environment injection.** Runtime context is suppressed, so no OS, git,
  cwd or file-tree snapshot is added.
- **Web-like tone.** The default `web-tone` prompt is an original prompt under
  80 tokens: natural, warm, willing to disagree, honest about uncertainty, no
  canned service phrases. `empty` removes the system prompt entirely.
- **Chat-friendly sampling.** Non-thinking requests default to `temperature: 1`
  (configurable 0–1.5), instead of the flat `0` that coding modes like.
- **Thinking stays available.** Pick a thinking level in the UI as usual; the
  plugin then stops sending a temperature, because thinking requests should not
  carry one.
- **Long conversations still compact.** The preset includes the standard
  compaction backend, and it only runs when the context window is under
  pressure; ordinary turns get no extra system text.
- **No default preset is modified.** The plugin inserts new loader/preset ids
  (`preset-chat` / `chat`); Standard, PTC, Minimal and Creator are untouched.

## Install

Once published on GitHub:

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode
```

Pin a commit for reproducibility:

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode#<sha>
```

For the Desktop app, open **Plugins → Add plugin** and install the same GitHub
spec. (`--profile desktop` is owned by the Desktop app, so the CLI refuses it by
design; use the app's plugin page there.)

Local development, no publish step:

```sh
dsh plugin --profile <profile> add /absolute/path/to/dsh-plugin-chat-mode
```

Then start (or restart) DSH, open a new chat, and choose **Chat** in the mode
switcher.

Requirements: a DSH build whose preset roster supports the Web/Desktop UI
(this plugin targets the `0.2.x` bundle layout). It is plain ESM with no
runtime dependencies and no native code.

## Configuration

Defaults live on the `chat-mode` row in [`cordis.patch.yml`](cordis.patch.yml):

```yaml
- id: chat-mode
  name: dsh-plugin-chat-mode
  config:
    promptMode: web-tone
    temperature: 1
    defaultThinking: off
```

Preset sub-rows are intentionally **read-only** in the Web plugin inventory:
DSH shows them as "provided by an agent preset" instead of offering a form. To
tune this mode without editing the installed profile patch, write a small user
file:

`$DSH_HOME/chat-mode.json` (`~/.dsh/chat-mode.json` by default)

```json
{
  "promptMode": "web-tone",
  "temperature": 1,
  "defaultThinking": "off"
}
```

The file overrides the row config, and invalid values are warned about and
ignored rather than breaking the preset.

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `promptMode` | `web-tone`, `empty`, `custom` | `web-tone` | `empty` sends no system prompt at all; `custom` uses `customPrompt`. |
| `customPrompt` | string | `""` | Used when `promptMode` is `custom`. An empty value also means "no system prompt". |
| `temperature` | number `0`–`1.5`, or `null` | `1` | Sent only on non-thinking requests. `null` never sends one. |
| `defaultThinking` | `off`, `follow-ui` | `off` | `off` starts a fresh chat with thinking disabled unless you already chose a level; `follow-ui` keeps the adapter default. |
| `traceFile` | path or `null` | `null` | Opt-in diagnostic: append one JSON line per model call with the resolved provider, model, effort, temperature and token cap. |

### About the defaults

- `defaultThinking: off` applies when a session is started or cleared, and only
  on DeepSeek routes (other providers may reject the `off` effort). It is
  deliberately not based on "no reasoning level recorded": this harness seeds a
  brand-new session with the adapter default (`high`) before the UI shows any
  choice. Resumed and compacted sessions keep whatever they recorded, and your
  later UI choice is respected.
- The plugin observes the reasoning level on every request, so turning thinking
  on in the UI immediately stops temperature injection for that chat.
- Temperature has no first-class setting in the current harness API, so the
  plugin sets it through the `agent/request` waterfall. That hook is marked
  deprecated upstream ("no replacement API" for per-request controls); if a
  future DSH release removes it, this option will simply become a no-op instead
  of breaking chat.

## Request shape

Approximate for the same three-word message, before conversation history:

| Field | Standard mode | Chat mode (`web-tone`) |
| --- | --- | --- |
| `system` | several KB of workflow rules + environment snapshot | ~250 characters of tone guidance |
| `tools` | ~20 schemas | **absent** |
| `thinking` | `enabled`, effort `high` by default | `disabled` by default |
| `temperature` | absent (provider default) | `1` |
| `max_tokens` | the harness' configured cap | the same cap (this plugin does not change it) |

With `promptMode: "empty"`, the `system` field is absent as well.

### Verifying it yourself

Set `traceFile` to a path outside the repository:

```json
{ "traceFile": "~/.dsh/chat-mode-trace.jsonl" }
```

Each model call appends one line with the resolved call configuration — provider,
model, reasoning effort, temperature and token cap — plus the session-start
decision when a new chat begins (`{"via":"agent/created","source":"startup",
"applied":true}`). Message bodies and system-prompt text are deliberately not
recorded.

For the request itself, a session log already carries the authoritative pieces:
`request/header` (model, tools and controls) and `system/message` (the system
prompt). Together with a trace line they show the complete shape without
recording any conversation content.

## Compatibility

- DSH Desktop / `dsh web`: tested against the current Desktop bundle.
- DSH Go and other clients built on the same DSH runtime: the preset is served
  by the harness preset registry, so a client that reads the roster
  dynamically should list it the same way the Web UI does. This has not been
  verified on a phone; treat it as "expected to work, pending device test".
- No native dependencies, no platform checks beyond none, no build step.

## Credits

- [deepseek-ai/dsh](https://github.com/deepseek-ai/dsh) — the harness this
  plugin extends, and the source of the preset/bundle conventions used here.
- [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) — the open
  web front end whose request habits (a `thinking` type, no explicit
  temperature) informed the parameter defaults.

## License

MIT. See [LICENSE](LICENSE).
