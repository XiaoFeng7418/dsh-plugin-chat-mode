[English](TECHNICAL_en.md) | [简体中文](TECHNICAL.md)

# Technical notes

For readers who want the implementation details, want to explain a difference, or want to verify the request shape themselves. For everyday use see [README](../README_en.md).

## How it works

- **A mode is a preset row.** `cordis.patch.yml` inserts `preset-chat` (`@deepseek-ai/dsh-agent-preset`, `config.id: chat`). Its `plugins` list is everything the mode runs: it lists no `tool-*` rows, so the preset itself declares no tools.
- **The system prompt is replaced wholesale.** The `chat-mode` row registers a `complete: true` system-prompt section; after `assemble()` it becomes the only section, so the harness identity, engineering rules and persona paragraphs are all dropped. Its `text` is a function that reads session state from `context.agent`, which is how one section serves different tones per session. In the `empty` tone the text is `''`, and the serialized `system` field disappears entirely.
- **Environment snapshot.** `suppressRuntimeContext()` drops OS / git / cwd / file-tree context. Content that other plugins inject as **user messages** (workspace reminders, memory blocks) is outside this plugin's reach and still appears.
- **Zero tools is enforced twice.** Not declaring tools only removes the preset's own tools. Tools registered **globally** by deployment plugins (agent-teams, MCP, memory, retrieval) are masked at the preset scope with `tools.restrict({ deny })`, and masked again on each agent's first step for tools registered later. The deny list excludes this mode's own `web_search` / `web_fetch`.
- **Temperature.** The `agent/request` waterfall adds `temperature` to the resolved call config. It is only sent on non-thinking requests; when thinking is on it is stripped even if a temperature was pinned. That hook is marked deprecated upstream ("no replacement API" for per-request controls); if a future release removes it the option silently becomes a no-op instead of breaking chat.
- **Compaction.** The preset mounts the standard `compaction-basic` backend; it only runs under context pressure and never adds text to ordinary turns.
- **No default preset is modified.** New loader/preset ids (`preset-chat` / `chat`) are used because a Cordis patch replaces a same-id row wholesale rather than merging.
- **Install touches no `node_modules`.** `dsh plugin add` records the package in the profile dependencies and `dsh.profile.bundles`; the bundle's `dsh.bundle.patch` points at `cordis.patch.yml`, and the loader inserts the `preset-chat` row at startup.

## Request shape

Approximate for the same message with empty history:

| Field | Standard mode | Chat mode (`web-tone`) |
| --- | --- | --- |
| `system` | several KB of workflow rules + environment snapshot | 61 characters (253 for the English tone line) |
| `tools` | ~20–103 schemas depending on installed plugins | absent (both `web-tone` and `empty`) |
| `thinking` | `enabled`, effort `high` by default | `disabled` by default |
| `temperature` | absent (provider default) | `1` |
| `max_tokens` | the harness' configured cap | the same cap (this plugin does not change it) |

With `promptMode: "empty"` the `system` field is absent as well.

### Engine differences (`rc.1` vs `rc.5`)

| Behaviour | `rc.5` (desktop) | `rc.1` (pinned by DSH Go) |
| --- | --- | --- |
| Body with no tools | still emits an empty `"tools": []` (about 15 bytes, no schemas — produced by the engine's `dsh-llm` layer, not removable by a plugin) | same |
| Global tool mask | works | works |
| `agent-teams`' nine tools | registered globally, so `tools.restrict` removes them | registered on **each agent's own scope**; `tools.restrict` only affects global registrations by design, so they stay |
| `agent/inbox/claimed` | dispatched normally | **not dispatched**; v0.2.0 routes session overrides and the default non-thinking turn through `pre-step` / `request`, so it does not depend on it |
| Short-turn input | ~1.9K tokens | ~3.9K tokens (leftover scoped tools plus context injected by other plugins) |

## Thinking-level mapping

The DeepSeek Messages protocol has two thinking states; each level maps onto them (`@deepseek-ai/dsh-llm-deepseek/src/serialize.ts`):

```ts
effort = options.reasoningEffort
      ?? connection.defaults.reasoningEffort
      ?? (connection.defaults.thinking === 'disabled' ? 'off' : 'high')
```

| Level | Request fields |
| --- | --- |
| `off` | `thinking: { type: "disabled" }`, no `output_config` |
| `low` / `high` / `max` | `thinking: { type: "enabled" }` plus `output_config: { effort: "low" \| "high" \| "max" }` |

With nothing recorded the adapter defaults to `high`, the DeepSeek web client's deep-thinking level, so `/think on` matches that switch. A `temperature` is only sent in the `off` level: the harness rejects a temperature alongside thinking, and the plugin drops it. `/think` writes the level through `agent.model.select()`, so it applies from the next turn.

## Configuration

`~/.dsh/chat-mode.json` (`$DSH_HOME/chat-mode.json`) overrides the row config in `cordis.patch.yml`. Priority: built-in defaults → row config → user file. A missing file means pure defaults; broken JSON or invalid values only produce warnings and never disable the mode.

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `promptMode` | `web-tone`, `empty`, `concise`, `creative`, `custom` | `web-tone` | System-prompt style |
| `customPrompt` | string | `""` | Used when `promptMode` is `custom` |
| `temperature` | number `0`–`1.5`, or `null` | `1` | Sent only on non-thinking requests; `null` never sends one |
| `creativeTemperature` | `0`–`1.5` | `1.28` | Used by the `creative` tone while the temperature is `auto` |
| `webSearch` | `true` / `false` | `false` | Allow web tools by default for new sessions |
| `webSearchProvider` | `deepseek-official` / `inherit` | `deepseek-official` | Search channel of the isolated preset runtime; `inherit` uses the host's global `web` settings |
| `savingsBaseline` | integer | `35967` | Standard input-token baseline used by `/chat savings` |
| `defaultThinking` | `off` / `follow-ui` | `off` | Starts the first turn of a session without a recorded level with thinking off |
| `traceFile` | path or `null` | `null` | Opt-in diagnostics, see below |

### `traceFile` diagnostics

```json
{ "traceFile": "~/.dsh/chat-mode-trace.jsonl" }
```

Each line is a small JSON object: the mount (`via: apply`), the global tool mask (`via: maskGlobalTools`), a first-turn thinking decision (`via: agent/inbox/claimed`; absent on `rc.1`) and one per resolved model call (`via: agent/request`, with provider / model / effort / temperature / maxTokens). Message bodies and system-prompt text are never recorded.

For the request itself, a session log already carries the authoritative pieces: `request/header` (model, tools, controls) and `system/message` (the system prompt). Together with one trace line they show the complete shape without recording conversation content.

### About the defaults

- `defaultThinking: off` applies to the first turn of a session with no recorded reasoning level, and only on DeepSeek routes; restored or continued sessions keep their recorded level, and a level you pick in the UI later wins.
- The plugin reads the level on every request, so turning thinking on in the UI immediately stops temperature injection.
- Session switches live in memory; a DSH restart falls back to the configuration file, and `/chat save` persists them.

## Why preset sub-rows are read-only in the UI

DSH's settings forms only cover volatile fields of active, uniquely addressable profile entries. Preset sub-rows belong to the preset definition: the plugin inventory shows them as provided by an agent preset and offers no form, which keeps a mode's behaviour from being silently overridden by local edits. Tune the mode through the user file instead.

## Known limits

- Content other plugins inject as **user messages** (workspace reminders, memory blocks) is outside this plugin's system-prompt scope and still appears; without such plugins it does not.
- Thinking being off by default is this plugin's choice, not a DSH limitation; set `defaultThinking: follow-ui` to follow the adapter default.
- The `empty` tone still triggers one small session-title request on the first message (DSH behaviour, ~64 max tokens), independent of this mode.
- A DSH build that composes the preset roster is required: the desktop/web UI works; `dsh headless` does not compose presets and cannot use it.
- On `rc.1` the leftover nine tools (`list_agents`, `send_message`, `wait_agent`, `team_task_*`, …) cannot be removed by a plugin; the practical workaround is temporarily disabling `agent-teams`.

## Development

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit + checkJs
pnpm test            # node:test
```

Re-mount after changes: `dsh plugin --profile <name> add /absolute/path/to/dsh-plugin-chat-mode`. Re-installing the same path in the desktop app asks for a restart; installing from a fresh directory reloads the running app.
