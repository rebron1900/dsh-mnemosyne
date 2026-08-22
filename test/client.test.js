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
  const stubReact = { createElement: (type, props, ...children) => ({ type, props, children }), useState: () => [null, () => {}], useCallback: (fn) => fn, useEffect: () => {} };
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
    assert.deepEqual(mod.inject, ["slots", "locale"]);
  });

  it("apply registers a locale dictionary and a settings.section slot", () => {
    const registered = { locale: [], slots: [] };
    const ctx = {
      effect: (fn, label) => fn(),
      locale: {
        register: (ns, dict) => { registered.locale.push({ ns, dict }); },
        bind: (ns) => (key) => `[${ns}]${key}`,
      },
      slots: {
        inject: (slot, fn) => fn(),
        register: (opts, render) => { registered.slots.push({ opts, render }); return () => {}; },
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
    assert.equal(typeof slot.render, "function");
  });

  it("the registered section renders a React element tree", () => {
    let slot = null;
    const ctx = {
      effect: (fn) => fn(),
      locale: { register: () => {}, bind: (ns) => (k) => k },
      slots: { inject: (_s, fn) => fn(), register: (opts, render) => { slot = { opts, render }; return () => {}; } },
    };
    mod.apply(ctx);
    const el = slot.render({ t: (k) => k });
    // render returns a React element whose type is the panel component
    assert.equal(typeof el.type, "function");
    assert.equal(typeof el.props.t, "function");
  });
});