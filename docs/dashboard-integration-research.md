# Mnemosyne Dashboard Integration Research

> Research date: 2026-08-25
>
> Scope: assess integration of [`wysie/mnemosyne-dashboard`](https://github.com/wysie/mnemosyne-dashboard) into `dsh-mnemosyne` as a strictly local, read-only viewer reached from the existing DSH Settings panel. This note does not propose enabling the upstream dashboard's authentication or maintenance features.

## Recommendation

Port a selected, read-only dashboard surface into `dsh-mnemosyne`'s existing Settings section, backed by new same-origin, loopback-only `GET` routes that query the active Mnemosyne SQLite bank with a read-only SQLite URI. Do not embed or start the upstream server in the initial implementation.

This direction preserves the requested no-login/no-mutation contract, avoids a second process and port, and fits the local plugin architecture already used by this repository. It should expose an in-panel dashboard entry or view toggle under the existing `settings.section` id `mnemosyne`; the project already uses that mechanism.

## Upstream Dashboard Findings

### Stack and architecture

`mnemosyne-dashboard` is a Hermes plugin, not a reusable React or DSH web module. Its [README](https://github.com/wysie/mnemosyne-dashboard/blob/main/README.md) describes a Python-standard-library server with static HTML/CSS/JS and no external JS runtime. The source layout places Hermes lifecycle tools in [`__init__.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/__init__.py), configuration in [`config.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/config.py), HTTP/static routing in [`server.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/server.py), SQLite access in [`dashboard_core.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/dashboard_core.py), and the UI under [`static/`](https://github.com/wysie/mnemosyne-dashboard/tree/main/static).

Its `DashboardStore.connect()` opens `file:<path>?mode=ro` through `sqlite3.connect(..., uri=True)` ([`dashboard_core.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/dashboard_core.py)); read views query Mnemosyne tables such as `working_memory`, `episodic_memory`, `triples`, and `consolidation_log`. The store feature-detects tables and columns, which is useful for upstream schema tolerance.

The upstream web server is `ThreadingHTTPServer` ([`server.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/server.py)). It serves static assets and JSON API endpoints from a separate origin/port. It also provides an SSE endpoint that polls the SQLite store, not a direct DSH event integration.

### Database path compatibility

The dashboard's default path resolution is Hermes-oriented: `~/.hermes/mnemosyne/data/mnemosyne.db`, with several environment fallbacks ([`config.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/config.py)). `dsh-mnemosyne` instead resolves `~/.dsh/mnemosyne/mnemosyne.db` by default and supports named banks under `banks/<bank>/mnemosyne.db` ([`src/index.js`](../src/index.js)). Any adoption must pass the DSH-resolved active-bank path explicitly; upstream auto-detection is not compatible by default.

### Authentication and mutation behavior

The upstream README says browsing is read-only by default, but the project is not intrinsically read-only:

- `DashboardStore` has `connect_rw()` and mutation methods including invalidation, importance, veracity, expiry, and supersession ([`dashboard_core.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/dashboard_core.py)).
- The HTTP server exposes `POST /api/config` and several `/api/admin/*` mutation routes ([`server.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/server.py)).
- Upstream protects admin routes with `memory_admin_enabled`; local requests can use admin mode without a password, while LAN/non-local use requires password auth ([`server.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/server.py)).
- Configuration defaults to `host = "0.0.0.0"`, `auth_enabled = false`, and `memory_admin_enabled = false` ([`config.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/config.py)). The README explicitly warns that its default binding exposes memory metadata to the LAN.

For this project, omit all of these surfaces: no password configuration, auth cookies, `/api/config`, admin APIs, SQLite write handles, backup/audit writes, or upstream process-management tools. “No login” is compatible with a same-origin, loopback-only DSH panel because the panel does not become a separately network-addressable application.

## DSH Integration Surfaces

### Existing project mechanisms

`dsh-mnemosyne` already provides both required extension halves:

- [`src/client.js`](../src/client.js) is a `window.__ModuleLoader__.load` browser bundle. It binds the `mnemosyne` settings scope and registers a `settings.section` row with id `mnemosyne`, order `50`, and the panel renderer.
- [`src/index.js`](../src/index.js) registers the host settings namespace and panel HTTP routes using `webServer.register({ kind: "exact", ... })`. Existing read routes require a loopback host and same-origin/unspecified `Sec-Fetch-Site`; mutation routes require a same-origin `Origin` check.

This matches DSH's local contracts:

- The client-module registry discovers packages declaring `dsh.client`, serves their browser bundle as `/plugins/<id>/client.js`, and builds the `window.__DSH_BOOT__` graph ([local DSH source: `node_modules/@deepseek-ai/dsh-client-modules/lib/index.js`](../../../../.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js)).
- Client bundles register `window.__ModuleLoader__.load({ id, factory })`; their module factory executes when materialized ([local DSH source: `node_modules/@deepseek-ai/dsh-client-modules/lib/client.js`](../../../../.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js)).
- The Settings shell projects registered `settings.section` entries by id, order, and label ([local DSH source: `node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`](../../../../.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js)).
- `webServer.register()` supports exact and prefix routes, rejects duplicate route paths, and owns the existing DSH listener ([local DSH source: `node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js`](../../../../.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js)).

### Candidate approaches

| Approach | Assessment |
| --- | --- |
| Iframe the upstream server | Not recommended. The upstream server sends `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` ([`server.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/server.py)), so a DSH iframe will be blocked. Removing those protections would create a distinct local web service with its own port, lifecycle, and trust boundary. |
| Open upstream dashboard in a new window | Viable only as a temporary development bridge, provided it is launched on `127.0.0.1`, receives the exact DSH database path, and is built or configured without all mutation routes. It remains operationally heavier: a child process, port allocation, readiness/stop handling, and a separately browsable memory UI. It also does not satisfy “entry in the configuration panel” as a native viewer. |
| Native read-only port | Recommended. Reuse upstream query semantics where valuable, but implement a deliberately smaller DSH host API and panel UI. This uses the existing settings panel, the one DSH web origin, and no separate dashboard authentication or server configuration. |

## `dsh-spend` New-Window Assessment

`dsh-spend` demonstrates a browser-only popup, not a DSH native-window API. The client calls `window.open("", "dsh-spend-details", "width=1020,height=680,resizable,scrollbars")`, retains the `Window` reference, focuses an existing window, and rerenders it when data changes ([`lib/client.js`](https://github.com/nonewind/dsh-spend/blob/main/lib/client.js)). It writes the popup document directly through `win.document.open()`, `document.write(...)`, and `document.close()`; the second context is plain DOM rather than React ([`lib/client.js`](https://github.com/nonewind/dsh-spend/blob/main/lib/client.js)).

It is not a model for hosting the upstream dashboard: it opens a blank same-origin document and injects already-held data, while the dashboard is a separate server with frame denial and a broad API surface. A popup can be blocked if it ceases to be directly user-gesture initiated, needs explicit null/popup-block handling, and duplicates styling/state/accessibility work. It should remain a fallback only for a future full-screen read-only DSH-rendered viewer, not the initial integration direction.

## Required Read-Only Security Contract

The implementation should enforce the following in code and tests:

1. Resolve only the current DSH Mnemosyne active-bank database with `resolveBankDbPath()`; do not accept an arbitrary database path from the browser.
2. Use SQLite read-only mode (`file:<db>?mode=ro`, URI enabled) and expose only allowlisted `SELECT`/SQLite metadata operations. Never instantiate write connections.
3. Register only `GET` dashboard endpoints. Return `405` for every other HTTP method, including `POST`, `PUT`, `PATCH`, and `DELETE`.
4. Reuse or strengthen the existing `trustedRead()` origin policy: loopback host plus same-origin fetch context. Return `403` for untrusted requests and `Cache-Control: no-store` for memory-bearing responses.
5. Keep the dashboard in the existing `mnemosyne` Settings section. Do not bind a new listener, expose a LAN host, create a login state, persist a dashboard-specific configuration document, or load remote assets.
6. Bound result counts, search lengths, response sizes, and query costs. Return generic errors without echoing raw filesystem paths beyond the configured Mnemosyne status display.
7. Treat memory content as sensitive. Avoid placing it in URLs, localStorage, copied popup markup, telemetry, or logs. Render untrusted content as text, never HTML.
8. Test route method rejection, origin rejection, absence of mutation routes, database open mode, active-bank selection, schema absence/degradation, and escaping/rendering of malicious memory content.

## Compatibility Hazards

- **Schema drift:** upstream queries multiple evolving Mnemosyne schemas and assumes some columns/tables. Preserve its feature detection concept and tolerate missing `triples`, `consolidation_log`, optional metadata columns, and alternate bank locations.
- **Upstream source quality:** the current `dashboard_core.py` snapshot contains a visibly malformed statement in `list_memories` (`status = ... .low         min_importance_value = None`). Treat upstream as a source of product behavior and query ideas, not a vendored dependency without pinning, tests, and repair.
- **Concurrent SQLite access:** read-only URI connections avoid writes but can still observe live updates. Keep handlers short-lived, use bounded timeouts, and handle `SQLITE_BUSY`/schema mismatch as panel-visible read errors.
- **Browser constraints:** the DSH client is hand-authored `__ModuleLoader__` JavaScript without a build chain. Port only the needed UI, use existing React and DSH design conventions, and avoid importing the upstream static application as-is.
- **Data scope:** `dsh-mnemosyne` defaults to session-scoped memory and named banks; a dashboard must clearly reflect the active bank and should not silently aggregate data from other paths or profiles.

## Suggested Delivery Sequence

1. Add a `DashboardStore`-style, host-local read adapter that uses `resolveBankDbPath()` and returns diagnostics, aggregate counts, recent memories, searchable memory rows, triples, and consolidation summaries.
2. Add read-only DSH exact routes under `/mnemosyne/dashboard/*`, protected with the existing local read gate and strict pagination/query validation.
3. Add a compact dashboard subview within the existing Mnemosyne Settings entry. Start with overview and explore; defer visualisers, realtime SSE, and 3D views until the bounded read API and schema compatibility are proven.
4. Add unit tests for all security invariants and route contracts, then manually verify that the web GUI can view a populated local database without creating, changing, or deleting any database or configuration state.

## Primary Sources

- [`wysie/mnemosyne-dashboard` README](https://github.com/wysie/mnemosyne-dashboard/blob/main/README.md)
- [`dashboard_core.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/dashboard_core.py)
- [`server.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/server.py)
- [`config.py`](https://github.com/wysie/mnemosyne-dashboard/blob/main/config.py)
- [`nonewind/dsh-spend` browser client](https://github.com/nonewind/dsh-spend/blob/main/lib/client.js)
- [`dsh-spend` package declaration](https://github.com/nonewind/dsh-spend/blob/main/package.json)
- Local project: [`src/index.js`](../src/index.js), [`src/client.js`](../src/client.js)
- Local DSH: `@deepseek-ai/dsh-client-modules/lib/index.js`, `@deepseek-ai/dsh-client-modules/lib/client.js`, `@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`, `@deepseek-ai/dsh-host-webserver/lib/index.js` under `/home/rebron1900/.local/share/fnm/node-versions/v24.18.1/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
