# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-22

### Added

- **Attachments in Chat mode, without giving up zero tools.** Images keep using
  the host's native vision (no tool, ≤1024 tokens each). Small text files
  (≤8 KiB) are inlined into the message. DOCX text is extracted with a
  zero-dependency reader (`word/document.xml` via `zlib.inflateRawSync`, 8 MiB
  per-part cap, XML entities decoded); PDF and legacy `.doc` files get one
  honest note that suggests a screenshot or Standard mode instead of failing.
- A `read_attachment` tool appears **only for the step whose current user
  message carries an upload**, and pages through larger files with
  `offset`/`limit`. It accepts only the `sha256:` ids of that message, so no
  path is ever read. Next to `/web on`, the allow list becomes
  `web_search` + `web_fetch` + `read_attachment`.
- `/chat` reports attachments indirectly: a text-only turn still shows zero
  tools in the request, so the token table in the README is unchanged.

### Changed

- Attachment state is captured from `agent/inbox/claimed` (the host evaluates
  conditional tool registrations before any `agent/pre-step` hook), with the
  pre-step projection kept as the fallback for engines that never emit it.

### Notes

- The current message's `file` block is replaced by its extracted text so the
  model can read it; that text is what the transcript shows for the turn, and
  history is not rewritten.

## [0.3.3] - 2026-11-22

### Fixed

- **Leaving Chat no longer leaves the session tool-starved.** A blank session
  can switch presets, and the host keeps the same Agent scope while it swaps the
  preset in the parent chain. The per-step allow list used to be appended to
  that shared scope without keeping its disposer, so after Chat -> PTC (or Chat
  -> Standard) every inherited tool stayed filtered out and `tools.compress`
  went missing. Each mask now owns its disposer and is released when the
  session's preset changes, when the agent is disposed, or when the plugin
  unloads; switching presets and switching back both rebuild the mask from the
  new state.

## [0.3.2] - 2026-11-20

### Changed

- Activation motion now matches the DeepSeek chat web app: the icon rotates once
  on a real off -> on transition (thinking 0 -> 180deg, 440ms
  `cubic-bezier(0.22, 1, 0.36, 1)`; web -24 -> 0deg, 400ms) and simply eases its
  colors back when switched off. The marker is derived from the previous render,
  so a theme change or any other re-render never spins the icon again.
- A click suppresses the hover hint until the pointer leaves the button, so the
  bubble no longer covers the composer after toggling.

### Fixed

- **No more square black frame around the pills.** The buttons now own every
  border, outline, appearance and tap-highlight property
  (`appearance: none`, explicit `border-style/width/color`, `outline: none`,
  `box-shadow: none`) under a container-scoped, element-qualified selector, so
  the Electron host reset can no longer paint its own rectangular border. Only
  `:focus-visible` (keyboard) shows a soft 2px rounded glow; a mouse click leaves
  a clean pill.

### Notes

- Client halves are served with a content revision taken from the file's
  timestamps, and bundles ship with `cache-control: immutable`. Editing
  `client.js` therefore needs a Host restart to recompute the revision — a
  browser hard refresh alone is not enough, and on desktop DSH has to exit
  completely (including the tray) before relaunching.

## [0.3.1] - 2026-11-20

### Added

- Toggle icons follow the DeepSeek chat UI: two-tone SVG line icons (no emoji),
  Chinese labels "深度思考" / "联网搜索" (English builds use "DeepThink" /
  "Search"), 34px pills with a 13px label, and a DeepSeek-blue active state
  instead of the theme's near-black brand token.
- Hover hints are a CSS-only bubble that fades in after 380ms
  ("先思考后回答，解决推理问题" / "按需搜索网页") and collapses the moment the
  button is pressed, so a click never waits for a tooltip.
- Subtle motion: 180ms color/elevation easing, a 120ms press-in,
  `scale(0.95)` while held, a 220ms icon pop when a toggle turns on, and a soft
  2px glow instead of a hard ring. All of it respects
  `prefers-reduced-motion: reduce`.

### Fixed

- **The Chat request could still carry a tool it does not belong to.**
  `working_directory` (a global tool added by newer DSH builds) leaked into the
  request because the mask only denied names it already knew. The mask now uses
  a per-session allow list (`web_search` / `web_fetch`, or nothing) that is
  immune to tools introduced later.
- Older engines: `@deepseek-ai/dsh` 0.2.1-rc.2 accepts `tools.restrict` only in
  an agent scope and ignores `register(definition, { when })`, so the web tools
  are registered unconditionally there and the allow list does the gating
  (`allow-own` -> `allow-none` -> deny fallback). Reasoning and web toggles now
  behave the same on rc.2 and rc.5.
- Two-tone icon colors were re-checked against WCAG AA: 5.07:1 (idle label),
  4.68:1 (hover), 6.31:1 / 5.38:1 in dark mode.

## [0.3.0] - 2026-11-20

### Added

- **Composer toggles** in the Chat preset: a "Think" switch (`off` <-> `high`)
  and a "Web" switch (`/web on` / `/web off`). They render only while the
  session runs under the `chat` preset, share the session state with the slash
  commands and the model chip, and click through `ctx.remote.commands.execute`,
  so a toggle never costs a model request.
- A `clientOnly` root patch row and a hand-written classic-script `client.js`
  that registers through `window.__ModuleLoader__` (no build step for users).
- Static client checks: classic-script shape, module id, slot id, preset gate,
  command plumbing, and the root row wiring.

### Fixed

- The host half now returns immediately for the `clientOnly` row, so mounting
  the client half cannot register the preset twice.
## [0.2.0] - 2026-11-20

### Added

- Local slash commands that never reach the model: `/chat` (status and help),
  `/tone` (`web` / `empty` / `concise` / `creative` / `custom <text>`),
  `/temp` (`auto` / `off` / `0`–`1.5`), `/think` (`on` = `high`,
  `off` / `low` / `max` / `auto`), `/web` (`on` / `off`), `/chat savings`
  and `/chat save`.
- Two new tone presets: `concise` (answer first, one sentence when one is
  enough) and `creative` (more associations, a little playfulness, paired with
  the higher `creativeTemperature` while the temperature is still `auto`).
- Optional `web_search` and `web_fetch` tools, off by default and enabled per
  session with `/web on`. While they are off the request carries no tool
  schemas. Turning them on adds about **+455 input tokens** as measured on
  0.2.2-rc.5 (16,230 → 18,050 request bytes).
- An isolated `web` runtime inside the Chat preset, pinned to
  `deepseek-official` search and `http` fetch, so enabling web tools does not
  depend on the user's global Search Provider and model-triggered search is
  billed as tokens instead of per call. `webSearchProvider: "inherit"` in
  `~/.dsh/chat-mode.json` falls back to the host runtime.
- `/think` switches the session's reasoning effort through `agent.model.select`;
  `on` maps to `high` (the DeepSeek web client's deep-thinking level) and no
  temperature is sent while thinking is on.
- `.github/workflows/ci.yml` (typecheck + tests), `CHANGELOG.md` and README
  badges.

### Fixed

- `/temp` now overrides the temperature the harness pinned in the request
  header after the first request, and `/temp off` removes it again; an empty
  `/temp` reports usage instead of silently meaning `0`.
- The per-session mask no longer denies the preset's own `web_search` /
  `web_fetch` tools, so `/web on` really reaches the request.
- Session overrides are keyed by `session.id`, so two windows no longer share
  a tone or web toggle.
- On engines without `agent/inbox/claimed` (DSH Go pins `0.2.2-rc.1`) the
  plugin keeps masking and temperature behaviour through `agent/created` /
  `agent/pre-step` / `agent/request`.

### Note

- DSH Go pins its bundled engine to `0.2.2-rc.1` for stability; `0.2.0` uses
  the `pre-step` / `request` paths for its session overrides so the slash
  commands keep working on that engine as well.
- Engines from 0.2.2-rc.5 on still emit an empty `"tools": []` (about 15 bytes,
  no schema) when the preset has no tools, because the engine's `dsh-llm`
  layer always passes an array; plugins cannot remove that field.
## [0.1.3] - 2026-11-19

### Added

- Every registered tool is masked per turn from `agent/created` and
  `agent/pre-step`, so tools a plugin registers after the preset mounted stay
  out of the request.

## [0.1.2] - 2026-11-18

### Added

- Chinese tone prompt, Chinese first README, Chinese preset name and locale.
- Release tarball install path.

### Changed

- Preset name is `Chat（轻量对话）` in Chinese installs.

## [0.1.1] - 2026-11-18

### Added

- `web-tone`, `empty` and `custom` prompt modes.
- `defaultThinking` and `temperature` options.
- `traceFile` diagnostics.

### Fixed

- Tools inherited from other plugins are masked at the agent scope.
- The default non-thinking choice is applied on the first turn of a new session.

## [0.1.0] - 2026-11-18

### Added

- Initial release: a `Chat` preset with no tool rows, a short tone prompt, no
  environment snapshot and a `temperature` of 1.

[0.3.0]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/releases/tag/v0.1.0
