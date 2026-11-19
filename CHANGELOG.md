# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-20

### Added

- Local slash commands that never reach the model: `/chat` (status and help),
  `/tone` (`web` / `empty` / `concise` / `creative` / `custom <text>`),
  `/temp` (`auto` / `off` / `0`–`1.5`), `/web` (`on` / `off`), `/chat savings`
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

[0.2.0]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/releases/tag/v0.1.0
