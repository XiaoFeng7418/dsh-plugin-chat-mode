# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-19

### Added

- Local slash commands that never reach the model: `/chat` (status and help),
  `/tone` (`web` / `empty` / `concise` / `creative` / `custom <text>`),
  `/temp` (`auto` / `off` / `0`–`1.5`), `/web` (`on` / `off`), `/chat savings`
  and `/chat save`.
- Two new tone presets: `concise` (answer first, one sentence when one is
  enough) and `creative` (more associations, a little playfulness, paired with
  the higher `creativeTemperature` when the temperature is still `auto`).
- Optional `web_search` and `web_fetch` tools, off by default and turned on per
  session with `/web on`. While they are off, the request body still has no
  `tools` field at all.
- `/chat savings` reports the input tokens this session used against the
  Standard baseline (35,967 by default) and how many were saved, using usage the
  plugin already sees. It costs no extra request.
- `/chat save` persists the current session's tone, temperature and web switch
  into `$DSH_HOME/chat-mode.json`.
- GitHub Actions workflow running typecheck and tests, plus README badges.

### Changed

- The tone section now reads the session state per agent, so one preset can
  serve different tones in different sessions at the same time.
- `defaultThinking` still applies to the first turn only, but the check now runs
  from `agent/inbox/claimed` and is skipped on engines that do not dispatch it
  (DSH Go's 0.2.2-rc.1), instead of replacing the prompt.

### Fixed

- Tests now cover per-session tone isolation, the web-tool switch, temperature
  resolution, usage accounting, `/chat save` and the trace file.

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
