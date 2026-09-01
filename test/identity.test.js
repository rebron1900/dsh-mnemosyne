import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_NS,
  MARKER_FILE_NAME,
  MARKER_PREFIX,
  SESSION_NS_PREFIX,
  WORKSPACE_NS_PREFIX,
  emptyIdentityMap,
  findMarker,
  findWorkspaceEntry,
  identityPath,
  isUnsafeBindTarget,
  loadIdentityMap,
  parseMarkerLine,
  readMarkerAt,
  resolveIdentity,
  resolveMemoryContext,
  saveIdentityMap,
  sessionNamespaceFor,
  sha256,
  upsertWorkspaceEntry,
  workspaceNamespaceFor,
} from "../src/identity.js";

const cleanups = [];
function trackDir(dir) {
  cleanups.push(dir);
  return dir;
}
function tempDir(prefix) {
  return trackDir(mkdtempSync(join(tmpdir(), `${prefix}-`)));
}

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe("parseMarkerLine / readMarkerAt / findMarker", () => {
  it("parses a valid marker line to a lowercase uuid", () => {
    assert.equal(
      parseMarkerLine("mnemosyne-workspace-v1: 9F2C1111-2222-3333-4444-555555555555"),
      "9f2c1111-2222-3333-4444-555555555555",
    );
  });

  it("rejects invalid versions, non-uuid values, and empty input", () => {
    assert.equal(parseMarkerLine("mnemosyne-workspace-v2: 9f2c1111-2222-3333-4444-555555555555"), null);
    assert.equal(parseMarkerLine("mnemosyne-workspace-v1: not-a-uuid"), null);
    assert.equal(parseMarkerLine(""), null);
    assert.equal(parseMarkerLine(null), null);
  });

  it("reads a marker at an exact directory", () => {
    const dir = tempDir("marker");
    writeFileSync(join(dir, MARKER_FILE_NAME), `${MARKER_PREFIX} 9f2c1111-2222-3333-4444-555555555555`);
    const found = readMarkerAt(dir);
    assert.equal(found.uuid, "9f2c1111-2222-3333-4444-555555555555");
    assert.ok(found.path.endsWith(MARKER_FILE_NAME));
  });

  it("returns null when no marker exists at a directory", () => {
    const dir = tempDir("nomarker");
    assert.equal(readMarkerAt(dir), null);
  });

  it("does not inherit a marker from a parent directory", () => {
    const root = tempDir("walk");
    const sub = join(root, "a", "b");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(root, MARKER_FILE_NAME), `${MARKER_PREFIX} 11111111-2222-3333-4444-555555555555`);
    assert.equal(findMarker(sub), null);
  });

  it("reads only the marker at the exact workspace root", () => {
    const dir = tempDir("exact");
    writeFileSync(join(dir, MARKER_FILE_NAME), `${MARKER_PREFIX} 22222222-3333-4444-5555-666666666666`);
    assert.equal(findMarker(dir).uuid, "22222222-3333-4444-5555-666666666666");
  });

  it("rejects symlinks that resolve to an unsafe binding root", () => {
    const dir = tempDir("symlink");
    const link = join(dir, "home-link");
    symlinkSync(tmpdir(), link, "dir");
    assert.equal(isUnsafeBindTarget(link, tmpdir()), true);
  });
});

describe("resolveIdentity (marker-only, no degradation)", () => {
  it("returns null when cwd is unusable", () => {
    assert.equal(resolveIdentity({ cwd: "" }), null);
    assert.equal(resolveIdentity({}), null);
  });

  it("returns null for an unbound directory (no marker), even under a git repo", () => {
    const dir = tempDir("nobind");
    mkdirSync(join(dir, ".git"));
    // No marker → null, regardless of git presence.
    assert.equal(resolveIdentity({ cwd: dir }), null);
  });

  it("resolves a marker to id:<uuid>", () => {
    const dir = tempDir("bound");
    writeFileSync(join(dir, MARKER_FILE_NAME), `${MARKER_PREFIX} 11111111-2222-3333-4444-555555555555`);
    const identity = resolveIdentity({ cwd: dir });
    assert.equal(identity.source, "id");
    assert.equal(identity.identityKey, "id:11111111-2222-3333-4444-555555555555");
    assert.ok(identity.markerPath.endsWith(MARKER_FILE_NAME));
  });
});

describe("namespace derivation", () => {
  it("workspace namespace uses full 64-hex sha256 of identityKey", () => {
    const key = "id:9f2c1111-2222-3333-4444-555555555555";
    const ns = workspaceNamespaceFor(key);
    assert.ok(ns.startsWith(WORKSPACE_NS_PREFIX));
    assert.equal(ns.length, WORKSPACE_NS_PREFIX.length + 64);
    assert.equal(ns, `${WORKSPACE_NS_PREFIX}${sha256(key)}`);
  });

  it("session namespace prefixes versioned terms and keeps default as-is", () => {
    assert.equal(sessionNamespaceFor("default"), DEFAULT_NS);
    assert.ok(sessionNamespaceFor("session-abc").startsWith(SESSION_NS_PREFIX));
    assert.ok(sessionNamespaceFor("dsh_session-abc").startsWith(SESSION_NS_PREFIX));
    assert.equal(sessionNamespaceFor(""), DEFAULT_NS);
    const once = sessionNamespaceFor("session-abc");
    assert.equal(sessionNamespaceFor(once), once);
  });
});

describe("identity.json index", () => {
  it("loadIdentityMap returns an empty map when missing", () => {
    const dir = tempDir("empty");
    assert.deepEqual(loadIdentityMap(dir), { version: 1, workspaces: [] });
  });

  it("loadIdentityMap returns an empty map on corrupt json", () => {
    const dir = tempDir("corrupt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(identityPath(dir), "{ not json", "utf8");
    assert.deepEqual(loadIdentityMap(dir), { version: 1, workspaces: [] });
  });

  it("saveIdentityMap then loadIdentityMap round-trips", () => {
    const dir = tempDir("rt");
    saveIdentityMap(dir, { version: 1, workspaces: [{ identityKey: "id:x", namespace: "dsh_v2_workspace_abc" }] });
    const map = loadIdentityMap(dir);
    assert.equal(map.workspaces.length, 1);
    assert.equal(map.workspaces[0].identityKey, "id:x");
  });

  it("findWorkspaceEntry locates a workspace by identity key", () => {
    const map = { version: 1, workspaces: [{ identityKey: "id:x", namespace: "n" }] };
    assert.equal(findWorkspaceEntry(map, "id:x").namespace, "n");
    assert.equal(findWorkspaceEntry(map, "id:missing"), null);
  });

  it("emptyIdentityMap has the right shape", () => {
    assert.deepEqual(emptyIdentityMap(), { version: 1, workspaces: [] });
  });
});

describe("upsertWorkspaceEntry", () => {
  it("creates a new entry with a minted namespace", () => {
    const dir = tempDir("upsert");
    const { entry, created } = upsertWorkspaceEntry(dir, { identityKey: "id:x", displayName: "x" });
    assert.equal(created, true);
    assert.ok(entry.namespace.startsWith(WORKSPACE_NS_PREFIX));
    assert.equal(entry.identityKey, "id:x");
    assert.equal(entry.displayName, "x");
    assert.ok(entry.boundAt > 0);
  });

  it("updates an existing entry and does not re-mint its namespace", () => {
    const dir = tempDir("update");
    const first = upsertWorkspaceEntry(dir, { identityKey: "id:x", displayName: "b" }).entry;
    const second = upsertWorkspaceEntry(dir, { identityKey: "id:x", displayName: "b2" }).entry;
    assert.equal(second.namespace, first.namespace);
    assert.equal(second.displayName, "b2");
    assert.equal(upsertWorkspaceEntry(dir, { identityKey: "id:x" }).created, false);
  });
});

describe("resolveMemoryContext", () => {
  it("session mode returns a session namespace", () => {
    const out = resolveMemoryContext({ cwd: "/tmp/x", sessionId: "session-abc", config: { recallMode: "session" } });
    assert.equal(out.mode, "session");
    assert.ok(out.namespace.startsWith(SESSION_NS_PREFIX));
    assert.equal(out.bound, true);
  });

  it("session mode with no session id returns default namespace", () => {
    const out = resolveMemoryContext({ cwd: "/tmp/x", config: { recallMode: "session" } });
    assert.equal(out.namespace, DEFAULT_NS);
  });

  it("workspace mode bound to a registered workspace uses its namespace", () => {
    const dir = tempDir("ctx");
    const project = tempDir("proj");
    writeFileSync(join(project, MARKER_FILE_NAME), `${MARKER_PREFIX} 11111111-2222-3333-4444-555555555555`);
    const key = "id:11111111-2222-3333-4444-555555555555";
    const { entry } = upsertWorkspaceEntry(dir, { identityKey: key, displayName: "proj" });
    const out = resolveMemoryContext({ cwd: project, sessionId: "session-abc", config: { recallMode: "workspace" }, dataDir: dir });
    assert.equal(out.mode, "workspace");
    assert.equal(out.namespace, entry.namespace);
    assert.equal(out.identityKey, key);
    assert.equal(out.bound, true);
  });

  it("workspace mode with a marker but not registered returns unbound (no remap)", () => {
    const dir = tempDir("ctx2");
    const project = tempDir("proj2");
    writeFileSync(join(project, MARKER_FILE_NAME), `${MARKER_PREFIX} 22222222-3333-4444-5555-666666666666`);
    const out = resolveMemoryContext({ cwd: project, sessionId: "session-abc", config: { recallMode: "workspace" }, dataDir: dir });
    assert.equal(out.mode, "workspace");
    assert.equal(out.bound, false);
    assert.equal(out.reason, "unbound");
    assert.equal(out.namespace, null);
    assert.equal(out.identityKey, "id:22222222-3333-4444-5555-666666666666");
  });

  it("workspace mode without a marker returns unbound with null namespace (no silent fallback)", () => {
    const project = tempDir("proj3");
    const out = resolveMemoryContext({ cwd: project, sessionId: "session-abc", config: { recallMode: "workspace" } });
    assert.equal(out.mode, "workspace");
    assert.equal(out.bound, false);
    assert.equal(out.reason, "unbound");
    assert.equal(out.namespace, null);
  });
});
