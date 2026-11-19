# Spike: composer "web search" toggle (v0.3.0 exploration)

Date: 2026-11-20. Branch: `spike/v0.3.0-web-toggle` (never merged into `feat/v0.2.0`).

## Question

Can a zero-build, plain-JavaScript client half add a DeepSeek-web-style "web search"
toggle next to the composer, switching the current session between `/web on` and
`/web off`?

## What was tried

1. **Client half inside the existing bundle** (`dsh-plugin-chat-mode`): added
   `exports["./client"]` and `dsh.client` to `package.json`. The composer slot
   `conversation.input.right` stayed empty (`occupants: []`) and `window.__DSH_BOOT__`
   carried no entry for the package.
2. **Separate spike package** (`dsh-chat-web-toggle`, host half is a no-op row):
   the host graph did pick it up — `__DSH_BOOT__` contained
   `{id: "dsh-chat-web-toggle", url: "plugins/??dsh-chat-web-toggle/client.js&rev=…", immediately: true}` —
   and `/plugins/.../client.js` served the file, but the slot still had no occupant.
3. Wrapped the file in `window.__ModuleLoader__.load({id, factory(require){…}})` like
   first-party bundles do, with both `require("react")` and a plain `apply(ctx)` shape.
   No registration.
4. Read `@deepseek-ai/dsh-client-modules`: bundles are **built** combo scripts whose
   factories are registered by a generated batch script; the bundle purity gate and the
   `require.asset`/`require.async` plumbing assume the repository's tsdown build.

## Findings

- The client half is discovered from **enabled Loader entries that declare `dsh.client`**,
  so a bundle that only contributes an agent-preset row can never carry UI code.
  A separate package (own row + `dsh.client`) is the correct shape.
- A hand-written `client.js` is served, but the shell expects a built bundle; nothing in
  the documented API registers a factory for an un-built package.
- `conversation.input.right` exists and its props include `inputActions`
  (`setDraft`, `submit`), so the click → `/web on` → `submit()` flow is sound once a
  component can be registered.
- `@deepseek-ai/dsh-client-modules@0.2.2-rc.1` (the DSH Go engine) contains the same
  `__ModuleLoader__`, `/plugins`, `immediately` and `fetchBundle` machinery, so the
  protocol is not rc.5-only.

## Recommendation for 0.3.0

Build the client half with the repository's tsdown/bundle tooling (combo script +
`__ModuleLoader__.load` factory) instead of shipping source. Then re-run this spike:
register a button into `conversation.input.right`, call
`inputActions.setDraft("/web on")` + `submit()`, and assert the next request carries
`web_search`/`web_fetch`. Keep the host side unchanged (the slash commands already
provide the behavioural contract).

## Status

Blocked at "un-built client half never registers its factory". Host side, protocol shape,
slot contract and rc.1 parity are all confirmed; only the bundle build remains.
