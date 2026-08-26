// Unit tests for the dsh-mnemosyne client module.
// Loads src/client.js by stubbing window.__ModuleLoader__ and a minimal react,
// then verifies apply() registers a settings.section slot and locale dictionary.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const clientSrc = readFileSync(fileURLToPath(new URL("../src/client.js", import.meta.url)), "utf8");

function loadClientModule() {
  const savedWindow = globalThis.window;
  const stubReact = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useSyncExternalStore: (_sub, snap) => snap(),
  };
  const mockRequire = (name) => {
    if (name === "react") return stubReact;
    throw new Error("unexpected require: " + name);
  };
  let captured = null;
  globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec.factory(mockRequire); } } };
  try {
    // eslint-disable-next-line no-eval
    eval(clientSrc);
    return captured;
  } finally {
    globalThis.window = savedWindow;
  }
}

describe("client module", () => {
  let mod;

  beforeEach(() => {
    mod = loadClientModule();
  });
  afterEach(() => {
    mod = null;
  });

  it("exports apply/name/inject for the cordis client plugin", () => {
    assert.equal(typeof mod.apply, "function");
    assert.equal(typeof mod.name, "string");
    assert.ok(Array.isArray(mod.inject));
    assert.deepEqual(mod.inject, ["settingsScope", "slots", "locale"]);
  });

  it("apply registers a locale dictionary and a settings.section slot", () => {
    const registered = { locale: [], slots: [] };
    const ctx = {
      effect: (fn) => fn(),
      locale: {
        register: (ns, dict) => { registered.locale.push({ ns, dict }); },
        bind: (ns) => (key) => `[${ns}]${key}`,
      },
      settingsScope: {
        bind: (opts) => ({ namespace: opts.namespace, getSnapshot: () => ({}), subscribe: () => () => {}, set: async () => {} }),
      },
      slots: {
        inject: (slot, gen) => {
          for (const r of gen()) {
            registered.slots.push({ opts: r.opts, render: r.render });
          }
        },
        register: (opts, render) => ({ opts, render }),
      },
    };
    mod.apply(ctx);

    assert.equal(registered.locale.length, 1);
    assert.equal(registered.locale[0].ns, "dsh-mnemosyne");
    assert.ok(registered.locale[0].dict.zh.nav);
    assert.ok(registered.locale[0].dict.en.nav);

    assert.equal(registered.slots.length, 1);
    const slot = registered.slots[0];
    assert.equal(slot.opts.name, "settings.section");
    assert.equal(slot.opts.id, "mnemosyne");
    assert.equal(slot.opts.order, 50);
    assert.equal(slot.opts.locale, "dsh-mnemosyne", "section opts declare the locale namespace");
    assert.equal(typeof slot.render, "function");
  });

  it("registers a single read-only dashboard tab when Better Sidebar is available", () => {
    const registered = { locale: [], tabs: [], opened: [] };
    const sidebar = {
      registerTab: (tab) => { registered.tabs.push(tab); return () => {}; },
      openTab: (seed) => registered.opened.push(seed),
    };
    const ctx = {
      effect: (fn) => fn(),
      get: (key) => key === "betterSidebar" ? sidebar : undefined,
      locale: {
        register: (ns, dict) => { registered.locale.push({ ns, dict }); },
        bind: (ns) => (key) => `[${ns}]${key}`,
      },
      settingsScope: {
        bind: (opts) => ({ namespace: opts.namespace, getSnapshot: () => ({}), subscribe: () => () => {}, set: async () => {} }),
      },
      slots: {
        inject: (slot, gen) => { for (const _entry of gen()) { /* settings registration is unrelated here */ } },
        register: (opts, render) => ({ opts, render }),
      },
    };
    mod.apply(ctx);
    assert.equal(registered.tabs.length, 1);
    const tab = registered.tabs[0];
    assert.equal(tab.id, "dsh-mnemosyne:memory-dashboard");
    assert.equal(tab.single, true);
    assert.equal(tab.order, 55);
    assert.equal(typeof tab.component, "function");
    assert.equal(tab.title(), "[dsh-mnemosyne]dashboardTitle");
    assert.equal(typeof tab.icon, "function");
    const dashboard = tab.component({ visible: true });
    assert.equal(typeof dashboard.type, "function");
    assert.equal(dashboard.props.t("dashboardTitle"), "[dsh-mnemosyne]dashboardTitle");
    const rendered = dashboard.type({ ...dashboard.props });
    assert.equal(rendered.type, "section");
    assert.equal(rendered.props.className, "mn-upstream");
    const frame = rendered.children[0];
    assert.equal(frame.props.className, "mn-upstream-frame");
    const iframe = frame.children[0];
    assert.equal(iframe.type, "iframe");
    assert.equal(iframe.props.src, "/mnemosyne/dashboard/?lang=en", "iframe passes the host language");
    assert.ok(registered.locale[0].dict.zh.dashboardTitle);
    assert.ok(registered.locale[0].dict.en.dashboardTitle);
  });

  it("registers the dashboard tab lazily when Better Sidebar appears after apply", () => {
    const registered = { locale: [], tabs: [], effects: [] };
    const sidebar = {
      registerTab: (tab) => { registered.tabs.push(tab); return () => {}; },
      openTab: () => {},
    };
    let injected = null;
    const ctx = {
      effect: (fn) => { registered.effects.push(fn); return () => {}; },
      inject: (deps, cb) => { if (deps && deps[0] === "betterSidebar") injected = cb; },
      locale: {
        register: (ns, dict) => { registered.locale.push({ ns, dict }); },
        bind: (ns) => (key) => `[${ns}]${key}`,
      },
      settingsScope: { bind: () => ({}) },
      slots: { inject: () => {}, register: () => ({}) },
    };
    mod.apply(ctx);
    assert.equal(registered.tabs.length, 0, "no eager registration when the service is absent");
    assert.equal(typeof injected, "function", "dynamic inject waits for the sidebar provider");
    // The provider arrives after apply: the injection callback now registers.
    injected({ betterSidebar: sidebar, effect: (fn) => { registered.effects.push(fn()); return () => {}; } });
    assert.equal(registered.tabs.length, 1);
    assert.equal(registered.tabs[0].id, "dsh-mnemosyne:memory-dashboard");
  });

  it("declares Hermes-compatible sync length controls", () => {
    assert.match(clientSrc, /key: "syncTurnUserLimit"/);
    assert.match(clientSrc, /key: "syncTurnAssistantLimit"/);
    assert.match(clientSrc, /syncTurnUserLimit: 500/);
    assert.match(clientSrc, /syncTurnAssistantLimit: 800/);
  });

  it("the registered section renders a React element tree", () => {
    let slot = null;
    const ctx = {
      effect: (fn) => fn(),
      locale: { register: () => {}, bind: (ns) => (k) => k, subscribe: () => () => {}, getSnapshot: () => ({ active: "en" }) },
      settingsScope: {
        bind: () => ({ getSnapshot: () => ({}), subscribe: () => () => {}, set: async () => {} }),
      },
      slots: {
        inject: (_s, gen) => {
          for (const r of gen()) {
            slot = { opts: r.opts, render: r.render };
          }
        },
        register: (opts, render) => ({ opts, render }),
      },
    };
    mod.apply(ctx);
    const el = slot.render({ t: (k) => k, scope: ctx.settingsScope.bind(), locale: ctx.locale });
    // render returns h("ul", ..., h(MnemosynePanel, props))
    assert.equal(el.type, "ul");
    assert.ok(el.children.length > 0);
    const panel = el.children[0];
    assert.equal(typeof panel.type, "function"); // MnemosynePanel
    assert.equal(typeof panel.props.t, "function");
    assert.ok(panel.props.scope);
    assert.ok(panel.props.locale, "panel receives the locale face for re-render on language switch");
  });
});