# Better Sidebar Integration Research

> Research date: 2026-08-25
> Scope: whether `dsh-mnemosyne` can add a strictly local, read-only Mnemosyne memory dashboard as a `dsh-better-sidebar` panel, without changing application source or configuration.

## Conclusion

**Yes.** `dsh-better-sidebar` exposes a browser-only Cordis service, `ctx.betterSidebar`, for third-party tabs. `dsh-mnemosyne` can register a dedicated single-instance `dsh-mnemosyne:memory-dashboard` tab from its client half and continue serving its own local read-only data from its host half. This is the appropriate integration boundary: Better Sidebar supplies layout, tab lifecycle, per-session placement, enablement, and optional side-card settings; Mnemosyne retains ownership of database access and security policy.

Do not make the dashboard a Better Sidebar file viewer and do not make the Mnemosyne host call `/sidebar/api/*`. The dashboard is application data rather than a workspace file, and `ctx.betterSidebar` does not exist in the host runtime. A client tab can fetch same-origin Mnemosyne routes while using Better Sidebar only as a client-side workbench service.

## Public Integration Contract

### Service location and lifecycle

`dsh-better-sidebar` publishes `betterSidebar` in its **client** `apply()` through `ctx.provide('betterSidebar', service)`, before mounting the workbench and before registering built-ins ([client source](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/client/index.tsx); [service source](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/client/service.ts)). Its own external-plugin guide explicitly states that no `ctx.betterSidebar` service exists in a consumer's host half; host code must use HTTP/WebSocket routes where it needs Better Sidebar data ([guide, section 1](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md)).

A consumer client declares `inject = ['betterSidebar']` so Cordis activates it only after the provider. Registration must be returned from `ctx.effect(() => ...)`; `registerTab()` returns a disposer that removes the registration when the client fiber is disposed, which prevents duplicate registrations during HMR or disabling/re-enabling ([guide, sections 3 and 9](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md)).

The current package is `dsh-better-sidebar` **0.16.1**, Node `>=20`, with DSH peers at `^0.1.0-rc.8`; its development validation pins DSH `0.1.1-rc.1`, while the README explicitly advertises DSH `0.1.0-rc.8`, `0.1.1-rc.1`, and `0.1.1-rc.2` ([package metadata](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/package.json); [README installation section](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/README.md)).

### Minimal registration shape

For this repository's unbuilt `window.__ModuleLoader__.load` client convention, the equivalent runtime shape is:

```js
const inject = ['settingsScope', 'slots', 'locale', 'betterSidebar'];

function apply(ctx) {
  // Existing Settings registration remains unchanged.
  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: 'dsh-mnemosyne:memory-dashboard',
    title: () => t('dashboardNav'),
    icon: /* ReactNode or (size) => ReactNode */,
    order: 55,
    single: true,
    component: (props) => h(MemoryDashboard, props),
  }), 'dsh-mnemosyne: register memory dashboard tab');
}
```

`registerTab()` requires a unique `id`, `title`, and `component`. `icon`, `order`, `hidden`, `available`, `single`, `dedupeKey`, `createTab`, `settings`, `badge`, `onOpen`, `onActivate`, `onClose`, and `urlTarget` are optional. `single: true` is shorthand for a type-level dedupe key; it is the right behavior for one dashboard per DSH session. The descriptor component receives `{ ctx, store, scope, tab, visible }`; `scope` contains `sessionId` and optional `cwd`, and `visible` is false when the tab is inactive or its panel is closed. Polling or subscriptions should pause when `visible` is false ([service definitions](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/client/service.ts); [guide, sections 4.1 and 4.2](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md)).

`openTab({ type: 'dsh-mnemosyne:memory-dashboard' })` can open or focus the tab programmatically. Newer service methods include `closeTab`, `activateTab`, `updateTab`, `getSnapshot`, `subscribeState`, and targeted `openTab(seed, scope)`. Features should be gated through `ctx.betterSidebar.features`, rather than string-version comparison, when using capability-added behavior. In 0.16.1, the feature list includes `badge`, `tabLifecycle`, `updateTab`, `openFile`, `targetedOpen`, `stateSubscription`, `tabMeta`, `pluginSettings`, `urlTarget`, `settingSelect`, and `floatWindows` ([service source](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/client/service.ts)).

### Permitted content and sizing

A tab component is an arbitrary React node rendered inside Better Sidebar's portal. It is not restricted to file content, iframe content, or a fixed size. The host controls the right and bottom workbenches, split panes, narrow-screen drawer behavior, and, in current versions, user-resizable/free-floating tab windows. The descriptor has no width or height fields; the dashboard must fill and respond to its provided container. The public guide describes external tabs as appearing in the `+` menu and opening in user-controlled panes, while the README documents the right-sidebar/bottom-panel and floating-window behavior ([external-plugin guide](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md); [README feature overview](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/README.md)).

The only settings surface contributed automatically is the Better Sidebar **Side card**: every registered tab gets an enable/disable card. Plugin-owned side-card settings may use `settings.pluginToggles` or `settings.render`; they persist in Better Sidebar's `pluginSettings[descriptor.id]`, must be JSON-serializable, and are suitable for presentation preferences such as page size. Mnemosyne operational configuration should remain in its existing Settings section and `config.yaml`, not be duplicated there ([guide, section 8](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md)).

## Host/Client Boundary for a Read-only Dashboard

Better Sidebar is a dual-half plugin, but its extension service is client-only. Therefore the implementation still needs both Mnemosyne halves:

- **Mnemosyne host:** add only same-origin, local read routes, for example `GET /mnemosyne/dashboard/summary`, `/memories`, `/triples`, and `/consolidations`. Resolve the already-selected data directory/bank internally and query it read-only. Do not accept a database path, mutation mode, or SQL from the browser.
- **Mnemosyne client:** register the tab and fetch those routes. Render memory fields as text, bound query/page parameters, and pause refresh work while `visible === false`.
- **Better Sidebar host:** no integration work is required. Its `/sidebar/api/*` endpoints are for Better Sidebar's own workspace/session functionality, not a service transport for external plugin data ([guide, section 6](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md)).

This preserves a strict read-only contract better than embedding a separate dashboard service: only GET routes are exposed, all SQLite handles can be opened with a read-only URI, and Mnemosyne's existing loopback/same-origin read fencing can remain authoritative.

## Fit With Existing Mnemosyne and Dashboard Work

`dsh-mnemosyne` already has the essential pieces:

- Its client is a browser module registered through `window.__ModuleLoader__.load`, uses React via the loader, and declares `inject = ['settingsScope', 'slots', 'locale']` ([`src/client.js`](../src/client.js)). Adding `betterSidebar` is a client-only dependency change.
- It registers one Settings entry, `settings.section` id `mnemosyne`, with order `50`, rendering the configuration/status panel ([`src/client.js`](../src/client.js)). That Settings panel should remain the location for install, diagnosis, test, data-path, embedding, consolidation, and automatic-memory controls.
- The existing client already fetches Mnemosyne same-origin endpoints such as `/mnemosyne/diagnose` and `/mnemosyne/config`, establishing the direct-fetch pattern for a dashboard tab ([`src/client.js`](../src/client.js)).
- The host already resolves a bank-aware database path through `resolveBankDbPath(dataDir, env)` ([`src/index.js`](../src/index.js)). A dashboard route should reuse this authority, not infer or accept another database location.

The prior local investigation of `wysie/mnemosyne-dashboard` reaches the complementary conclusion: its selected views and schema-tolerance ideas are useful, but embedding or running its server is not the right initial design. The upstream dashboard is a separate Python server with broader mutation/auth/process surfaces; a native DSH tab can reuse only the read-oriented query model while avoiding a second listener and trust boundary ([dashboard research](dashboard-integration-research.md)).

## Third-party Patterns

The Better Sidebar maintainers identify `dsh-sentinel` as the first third-party `ctx.betterSidebar` consumer: it registers a single `dsh-sentinel:watches` tab at order 60 and treats Better Sidebar as an optional soft dependency. The same guide lists `dsh-sidebar-qa` as another tab consumer ([guide, section 11](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md)). These are useful registration/lifecycle examples, but `dsh-mnemosyne` should retain its independent Settings panel rather than replace it.

The package documentation recommends a peer, rather than ordinary dependency, for `dsh-better-sidebar`, marked optional so a plugin continues to load when Better Sidebar is absent. That recommendation assumes a built TypeScript package. This project does not currently have a build/type pipeline and is loaded from a DSH profile bundle, so the practical runtime compatibility pattern is a **soft client dependency**: do not add `betterSidebar` to the mandatory static `inject` list unless the profile always installs it. Instead obtain it with `ctx.get('betterSidebar')` inside a client effect and register only when present, or ship a separate optional client integration entry that declares `inject = ['betterSidebar']`. This avoids making the existing Mnemosyne Settings panel fail to activate when Better Sidebar is not installed.

## Compatibility and Delivery Risks

1. **Provider availability and activation order:** a hard `inject: ['betterSidebar']` makes the entire current client wait for or fail without the provider. Because Better Sidebar is optional for Mnemosyne users, isolate the integration or use a guarded `ctx.get()`/reactive availability pattern. Test both profiles.
2. **Version drift:** public service capability has expanded after v0.12.0. Target the stable core `registerTab` contract, and gate any optional use of `features` such as `pluginSettings`, `badge`, or `targetedOpen`. The published guide's version header says v0.12.0 while the current package/source is 0.16.1, so source and generated type declarations should be treated as authoritative for exact fields.
3. **Service is client-only:** importing or calling it from `src/index.js` is an architectural error. Host routes and database queries remain normal Mnemosyne responsibilities.
4. **Duplicate registration/HMR:** use `ctx.effect(() => registerTab(...))` so the returned disposer is owned by the Cordis fiber. Do not call `registerTab()` directly at module evaluation time.
5. **Persisted tab state:** Better Sidebar retains layout/tab state per session. If Mnemosyne is disabled or absent, a saved tab becomes an orphan placeholder until the plugin returns; this is expected behavior documented by the provider ([guide, section 9](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md)).
6. **Panel state is not memory scope:** Better Sidebar's `scope.sessionId` is a UI placement scope. It must not override Mnemosyne's configured active-bank or session-isolation policy. The data API should identify the current configured Mnemosyne bank itself and present that scope clearly.
7. **Package/toolchain mismatch:** Better Sidebar expects React 18-style built client bundles and declares broad DSH peers. `dsh-mnemosyne` has a hand-authored module-loader client and only declares settings/tools peers. A direct runtime call through Cordis is feasible, but a declared package peer should be added only if this repository later chooses an explicit install-time dependency contract.

## Recommended Implementation Sequence

1. Add a narrow read adapter in `src/index.js`, reusing active-bank resolution and opening SQLite only in read-only mode. Define bounded, response-shaped queries for summary, paginated recent/searchable memories, triples when present, and consolidation history when present.
2. Add only guarded `GET /mnemosyne/dashboard/*` routes with the current trusted-read policy, pagination/search limits, `Cache-Control: no-store`, and tests that non-GET requests and non-local origins fail.
3. Implement `MemoryDashboard` in `src/client.js` as a responsive dashboard view. Keep it read-only: no mutation controls, no raw SQL, no route-selected database paths, and no untrusted HTML rendering.
4. Add the Better Sidebar registration as an optional client integration. Use descriptor id `dsh-mnemosyne:memory-dashboard`, `single: true`, a prefixed icon/title, and `visible`-gated polling. Retain the Settings `mnemosyne` section unchanged for operational configuration.
5. Test with Better Sidebar absent, with 0.16.1 installed, across two sessions/banks, and through client HMR/reload. Verify no writes occur by using a read-only DB connection and checks against database/config modification timestamps or an explicit write-block test.

## Primary Sources

- [DSH Better Sidebar README](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/README.md)
- [External plugin guide](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md)
- [Better Sidebar package metadata](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/package.json)
- [Client service source](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/client/service.ts)
- [Client provider source](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/client/index.tsx)
- [Host source](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/index.ts)
- [This project's client](../src/client.js)
- [This project's host](../src/index.js)
- [Existing upstream dashboard integration research](dashboard-integration-research.md)
