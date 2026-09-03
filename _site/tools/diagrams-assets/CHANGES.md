# Changes from upstream draw.io

Diagrams is a fork of [draw.io](https://github.com/jgraph/drawio), licensed
under the Apache License 2.0. This file records modifications made to the
original work, as required by Section 4(b) of that License.

**Fork point:** upstream commit `074a2ea4`, draw.io version 31.4.2.

Individual modified files also carry a change notice in their header, in the
form:

    Modified <YYYY-MM-DD> by Hossein Oliabak as part of Diagrams.
    Changes from the original are licensed under the Apache License 2.0.

## Modifications

| Date | Area | Change |
|---|---|---|
| 2026-09-03 | Build | Upgraded the bundled Closure Compiler in `etc/build/compiler.jar` from v20220502 to v20260831. Verified: `ant app` builds with 0 errors and 0 warnings, and the resulting bundle boots with 0 console errors and 0 failed requests. Output grew 3,820 bytes (+0.04%). |
| 2026-09-03 | Branding | Rebranded to Diagrams: `index.html` (title, meta, canonical, splash), `images/manifest.json`, `images/browserconfig.xml`, `clear.html`, and a new icon set generated from `etc/branding/`. Theme colour #d89000 -> #22176F. |
| 2026-09-03 | Branding | Replaced 5,083 value-side occurrences of "draw.io" with "Diagrams" across all 59 `resources/dia*.txt` locale files, and 58 `app.diagrams.net` URLs with `diagrams.oliabak.com`. Resource *keys* (including the key literally named `draw.io`) are unchanged. |
| 2026-09-03 | Branding | `Editor.prototype.appName` -> `Diagrams` (this drives `document.title`). Template-picker category label -> `Diagrams`. The 18 internal `getServiceName() == 'draw.io'` deployment checks are deliberately left alone: they are an internal discriminator, never user-visible. |
| 2026-09-03 | Privacy | Removed upstream's hard-coded telemetry hosts in `js/diagramly/Init.js`, which set `window.DRAWIO_LOG_URL` to `log.diagrams.net` / `log.draw.io` via a hostname *suffix* match. This fork sends no telemetry. |
| 2026-09-03 | Links | Repointed Help menu targets that implied an upstream service relationship: `support` (was `github.com/jgraph/drawio/wiki/Getting-Support`), `downloadDesktop` (was `get.diagrams.net`), Electron `website` (was `drawio.com`), and the remote `shortcuts.svg` fallback. Removed upstream's YouTube walkthrough from both Help menus. |
| 2026-09-03 | Attribution | Added an About dialog. Upstream renders only a version label; this fork opens a dialog carrying the Apache 2.0 attribution, links to the upstream project and licence, and the trademark disclaimer. Built with `textContent`, links carry `rel="noopener noreferrer"`. |
| 2026-09-03 | Fix | Added the missing `images/mstile-150x150.png`, referenced by `browserconfig.xml` but never shipped upstream (a 404 on every load). |
| 2026-09-03 | Backends | Disabled Dropbox, OneDrive/SharePoint and GitLab via `urlParams` in `js/PreConfig.js` rather than by deleting files, keeping the fork cheap to rebase. Trello was already off by default. Verified: File > Open from / Import from now offer only Browser, Device and URL. |
| 2026-09-03 | Security | Removed five hard-coded upstream OAuth identities that this fork would otherwise have authenticated with: draw.io's Google client ID and app ID (`js/diagramly/DriveClient.js`), and its GitHub App, Dropbox and GitLab IDs plus a second Google client (`js/diagramly/Init.js`). All now default to null. |
| 2026-09-03 | Privacy | Repointed two endpoints that silently sent user content to third parties. `EXPORT_URL` defaulted to `convert.diagrams.net/node/export` and `VSS_CONVERT_URL` to `convert.diagrams.net/VsdConverter/api/converter`; both now target same-origin paths that are not served, so the features fail closed instead of uploading. `DRAWIO_LIGHTBOX_URL` moved off `viewer.diagrams.net`. |
| 2026-09-03 | Verified | Network egress test: loaded the app, drew on the canvas and opened the storage menus. Only origin contacted was the local server; zero external requests, zero page errors. |
| 2026-09-03 | Deploy | Added `build-dist.sh`, which copies only what production serves into `dist/`: 133 MB and 3,083 files, down from 155 MB and 3,411. Excludes `WEB-INF/` (whose placeholder `*_client_secret` files must never be published), the unminified dev sources, and the disabled backends' pages. The fork keeps upstream's full tree so rebases stay clean. Verified: the trimmed tree boots with zero external requests, zero failed requests and zero errors. |
| 2026-09-03 | Desktop | Built a macOS application from this fork via drawio-desktop, whose submodule pins the same upstream commit. Bundle id `com.oliabak.diagrams`, own icon, copyright carrying the draw.io attribution. Registered as an Alternate handler for .drawio so an existing draw.io install keeps the default association. |
| 2026-09-03 | Desktop fix | The desktop app quit instantly on launch. Upstream's `package.json` has `name: \"draw.io\"`, so Electron used `~/Library/Application Support/draw.io`, the same profile as an installed draw.io, and `requestSingleInstanceLock()` failed whenever the real app was running. Added `productName: \"Diagrams\"` so it gets its own profile and the two coexist. |
| 2026-09-03 | Desktop fix | electron-builder with `identity: null` leaves the bundle carrying Electron's linker signature while rewriting Info.plist, which Apple Silicon refuses to launch. `build-mac.sh` ad-hoc re-signs after packaging; the bundle then validates and satisfies its Designated Requirement. |
| 2026-09-03 | Scope | Dropped the hosted deployment. There is no `diagrams.oliabak.com`: `DRAWIO_LIGHTBOX_URL` now points at an unserved same-origin path so the lightbox fails closed, keyboard shortcuts always load locally, the canonical link points at the tool page, and 58 locale references to the dead subdomain were repointed. |
| 2026-09-03 | Install | Installed to `/Applications/Diagrams.app`, verified launching with its own renderer alongside an existing `/Applications/draw.io.app`. |
| 2026-09-03 | Legal | Added `NOTICE` and this `CHANGES.md` to satisfy Apache License 2.0 Section 4. |
