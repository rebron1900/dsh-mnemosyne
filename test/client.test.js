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