[English](README_en.md) | [简体中文](README.md)

# dsh-plugin-chat-mode

A minimal, **tool-free chat preset** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

It adds a `chat` mode to the mode switcher: no tool schemas, no engineering
workflow prompt, no environment snapshot — just a short conversation-tone system
prompt and a temperature that suits everyday chat. It is meant for the times
when you want to use the API like the DeepSeek web app instead of starting a
coding agent.

## Why

The default presets are built for work. Every request carries a hundred tool
schemas plus a multi-kilobyte system prompt with file-editing discipline,
planning rules and a runtime snapshot of the OS, git state, cwd and file tree.
That is the right trade-off for agent work, and the wrong one for "explain this
paragraph to me":

- tool definitions dominate the prompt even when no tool is ever called;
- the workflow language makes the model sound like a task worker ("当然可以！我很乐意为您解答");
- a chat that never touches the filesystem still pays for the filesystem rules.

This plugin keeps the same harness, session model and UI, and removes the parts
a conversation does not need.

## Measured

A fresh session with one message ("say hi in one sentence") on a desktop install
that has several other plugins loaded:

**Standard mode (36K tokens / ¥0.0361)**

![Standard mode, 36K tokens](assets/standard-36k.png)

**Chat mode (1.9K tokens / ¥0.0021)**

![Chat mode, 1.9K tokens](assets/chat-mode-1.9k.png)

| | Standard | Chat (`web-tone`) | Chat (`empty`) |
| --- | --- | --- | --- |
| `tools` field | 103 schemas | **absent** | **absent** |
| `system` | 14,476 characters | 61 characters (253 for the English tone line) | **empty (field absent)** |
| thinking | on, effort `high` | off by default | off by default |
| `temperature` | not sent | **1.0** | **1.0** |
| input tokens | 35,967 | **1,880** | **1,842** |

About 19x fewer input tokens, and no `"tools": []` either — the whole field is
omitted. The two screenshots above are that same greeting in both modes
(36K vs 1.9K).

> The numbers come from one desktop install with a fair number of other plugins
> (they are the tools being masked, not tools this preset declares). Absolute
> values vary with the deployment; the ratio and the absent `tools` field do not.

## What it does

- **Zero tools.** The preset declares no `tool-*` rows, and the plugin masks
  every global tool other plugins register at the preset scope (`tools.restrict`),
  then re-masks each agent on its first step for tools registered later. The
  request therefore has no `tools` field at all — not an empty array, no field.
  Without the mask a preset alone cannot unregister tools that a deployment-level
  plugin contributes.
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
  (`preset-chat` / `chat`); Standard, PTC, Minimal, Creative and any other presets you have installed are untouched.

## Install

### CLI / other DSH clients

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode
```

Install the packaged tarball from a GitHub Release:

```sh
dsh plugin --profile <profile> add https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/releases/download/v0.1.3/dsh-plugin-chat-mode-0.1.3.tgz
```

Pin a commit for reproducibility:

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode#v0.1.3
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
| `defaultThinking` | `off`, `follow-ui` | `off` | `off` starts the first turn of a new chat without thinking unless a level is already recorded; `follow-ui` keeps the adapter default. |
| `traceFile` | path or `null` | `null` | Opt-in diagnostic: append JSON lines for the mount, the tool mask, the thinking decision and each resolved model call. |

### About the defaults

- `defaultThinking: off` applies to the first turn of a chat that has no recorded
  reasoning level, and only on DeepSeek routes (other providers may reject the
  `off` effort). A restored or continued session keeps whatever it recorded,
  and any level you pick in the UI later wins.
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

Each line is a small JSON object: one for the mount (`via: apply`), one for the
global-tool mask (`via: maskGlobalTools`), one when a first turn decides the
reasoning level (`via: agent/inbox/claimed`), and one per resolved model call
(`via: agent/request`) with provider, model, effort, temperature and token cap.
Message bodies and system-prompt text are deliberately not recorded.

For the request itself, a session log already carries the authoritative pieces:
`request/header` (model, tools and controls) and `system/message` (the system
prompt). Together with a trace line they show the complete shape without
recording any conversation content.

## Compatibility

- DSH Desktop / `dsh web`: tested against the current Desktop bundle.
- **Android DSH Go: verified on-device (1.1.0, bundled engine `0.2.2-rc.1`).**
  Install it from the web UI under Plugins → `+` (GitHub URL, release tarball, or
  a local directory path), enable it, then pick **Chat (lightweight)** from the
  preset picker in the *web* interface — see the next section.
- No native dependencies, no platform checks beyond none, no build step.

### On DSH Go (Android)

1. In DSH Go open Plugins → `+` in the sidebar, enter
   `github:XiaoFeng7418/dsh-plugin-chat-mode`, or the download URL of
   `dsh-plugin-chat-mode-0.1.3.tgz` from the `v0.1.3` release, or a local
   directory path that exists on the phone, install, then tap "enable".
2. The **native UI only offers DSH Go's own modes** (Work / Companion / Tavern)
   and does not show DSH presets. Tap "switch to web interface" in the sidebar,
   then pick **Chat (lightweight)** from the preset picker on a new session.
3. What differs, honestly:
   - Desktop (engine `rc.3` and newer): no `tools` field, a 61-character system
     prompt, about **1.9K input tokens** per short turn.
   - The `rc.1` engine bundled in DSH Go: the system prompt takes effect and the
     request goes through the same no-tools path, but **a few context blocks or
     tools injected by other global plugins may still appear** (tools registered
     by other plugins, runtime reminders), measured at about **3.9K input
     tokens**. This should converge once DSH Go ships a newer engine; with only
     this plugin installed the difference is negligible.
4. If you want the phone to feel as lean as the desktop:
   - On `rc.1` those leftover nine tools (`list_agents`, `send_message`,
     `wait_agent`, `team_task_*`, …) are registered by the **Agent Teams /
     `agent-teams`** plugin on **each agent's own scope**. `tools.restrict` only
     removes **global** registrations by design, so this plugin cannot mask them
     there (on desktop `rc.3+` the same tools are global, which is why masking
     works).
   - Practical tip: if a casual chat does not need multi-agent collaboration,
     temporarily disable **`agent-teams`** in DSH Go's plugin manager (and any
     other global plugin you do not need that injects context), and those nine
     tools disappear — close to the desktop experience. Once DSH Go ships an
     `rc.3+` engine, no manual disabling is needed.


## Credits

- [deepseek-ai/dsh](https://github.com/deepseek-ai/dsh) — the harness this
  plugin extends, and the source of the preset/bundle conventions used here.
- [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) — the open
  web front end whose request habits (a `thinking` type, no explicit
  temperature) informed the parameter defaults.

## License

MIT. See [LICENSE](LICENSE).
