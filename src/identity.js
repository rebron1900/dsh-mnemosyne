/**
 * @file Workspace identity resolution for Mnemosyne memory scope.
 *
 * This module is the pure, host-independent face of the workspace-scope design
 * (docs/design-workspace-memory-scope.md §5.2/§5.3/§6). Identity is determined
 * solely by the project-root `.mnemosyne-id` marker — no automatic git/path
 * derivation, no silent degradation. An unbound workspace is an explicit state
 * the caller surfaces (bind hint) rather than something quietly remapped.
 *
 * No DSH host services are required, so the whole module is testable in
 * node:test without a running harness.
 *
 * Endpoint contract (the only thing the runtime calls):
 *   resolveMemoryContext({ cwd, sessionId, config, dataDir }) → MemoryContext
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

/** Default mnemosyne dataDir (~/.dsh/mnemosyne). */
export const DEFAULT_DATA_DIR = join(homedir(), ".dsh", "mnemosyne");
/** Marker file name that delimits a bound workspace in a project root. */
export const MARKER_FILE_NAME = ".mnemosyne-id";
/** Marker content version prefix. */
export const MARKER_PREFIX = "mnemosyne-workspace-v1:";
/** identity.json index file name (inside the mnemosyne dataDir). */
export const IDENTITY_FILE_NAME = "identity.json";
/** Current identity.json schema version. */
export const IDENTITY_VERSION = 1;
/** Prefix for versioned workspace namespaces. */
export const WORKSPACE_NS_PREFIX = "dsh_v2_workspace_";
/** Prefix for versioned session namespaces. */
export const SESSION_NS_PREFIX = "dsh_v2_session_";
/** The legacy shared "default" namespace. */
export const DEFAULT_NS = "default";
/** Workspace namespace digest length (full 64-hex sha256, never truncated). */
export const WS_DIGEST_LEN = 64;
/** Marker accepted only when it carries a UUID-shaped value. */
export const MARKER_VALUE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @typedef {"id"} IdentitySource
 * @typedef {{ identityKey: string, source: IdentitySource, markerPath: string, canonicalPath: string }} Identity
 * @typedef {{ mode: "session" | "workspace", namespace: string | null, identityKey: string | null, source: IdentitySource | "session" | "unbound", displayName: string | null, bound: boolean, reason?: string }} MemoryContext
 */

/** sha256 hex digest of a string. */
export function sha256(input) {
  return createHash("sha256").update(String(input)).digest("hex");
}

/**
 * Parse a marker file line into a UUID value.
 * @param {string} line
 * @returns {string | null}
 */
export function parseMarkerLine(line) {
  if (typeof line !== "string") return null;
  const text = line.trim();
  if (!text.startsWith(MARKER_PREFIX)) return null;
  const value = text.slice(MARKER_PREFIX.length).trim();
  return MARKER_VALUE_RE.test(value) ? value.toLowerCase() : null;
}

/**
 * Read and validate a marker file at an exact directory.
 * @param {string} dir
 * @returns {{ uuid: string, path: string } | null}
 */
export function readMarkerAt(dir) {
  const markerPath = join(dir, MARKER_FILE_NAME);
  try {
    if (!existsSync(markerPath)) return null;
    const uuid = parseMarkerLine(readFileSync(markerPath, "utf8"));
    return uuid ? { uuid, path: markerPath } : null;
  } catch {
    return null;
  }
}

/**
 * Read the workspace marker at the exact workspace root only.
 * A child workspace never inherits a marker from a parent directory.
 * @param {string} startDir
 * @returns {{ uuid: string, path: string } | null}
 */
export function findMarker(startDir) {
  if (typeof startDir !== "string" || !startDir) return null;
  return readMarkerAt(resolve(startDir));
}

/** Filesystem-canonicalize a path (resolve symlinks) or return null. */
export function canonicalize(p) {
  try {
    return realpathSync(resolve(p));
  } catch {
    return null;
  }
}

/**
 * Resolve a workspace identity from a directory. Marker-only: a valid
 * `.mnemosyne-id` at that exact directory yields `id:<uuid>`; absent → null.
 * Never auto-creates a marker and never degrades to git/path.
 * @param {{ cwd?: string }} param0
 * @returns {Identity | null} null when cwd is unusable or unbound.
 */
export function resolveIdentity({ cwd }) {
  if (typeof cwd !== "string" || !cwd) return null;
  const canonicalPath = canonicalize(cwd);
  if (!canonicalPath) return null;

  const marker = findMarker(cwd);
  if (!marker) return null;
  return {
    identityKey: `id:${marker.uuid}`,
    source: "id",
    markerPath: marker.path,
    canonicalPath,
  };
}

/** Derive the opaque workspace namespace for an identity key. */
export function workspaceNamespaceFor(identityKey) {
  return `${WORKSPACE_NS_PREFIX}${sha256(identityKey)}`;
}

/**
 * Atomically write a marker file into a directory (tmp + rename). The caller
 * owns consent — this is only invoked by explicit bind/adopt flows, never
 * automatically.
 * @param {string} dir
 * @param {string} uuid
 * @returns {string} the marker path written
 */
export function writeMarkerAt(dir, uuid) {
  const target = join(dir, MARKER_FILE_NAME);
  const tmpPath = join(dir, `.${MARKER_FILE_NAME.slice(1)}-${process.pid}-${Date.now()}.tmp`);
  const content = `${MARKER_PREFIX} ${uuid}\n`;
  writeFileSync(tmpPath, content, "utf8");
  try {
    renameSync(tmpPath, target);
  } catch {
    writeFileSync(target, content, "utf8");
    try { unlinkSync(tmpPath); } catch { /* best-effort */ }
  }
  return target;
}

/**
 * Safety gate for binding: refuse absurd roots that would make one namespace
 * own far too much (the home directory itself or the filesystem root).
 * @param {string | undefined} cwd
 * @param {string | undefined} home
 * @returns {boolean} true when the target must NOT be bound.
 */
export function isUnsafeBindTarget(cwd, home = homedir()) {
  if (typeof cwd !== "string" || !cwd) return true;
  // Compare canonical paths so a symlink to $HOME or / cannot bypass the gate.
  const resolved = canonicalize(cwd) ?? resolve(cwd);
  const homeResolved = canonicalize(home) ?? resolve(home);
  return resolved === "/" || resolved === homeResolved;
}

/** Derive a versioned session namespace from a root session sid. */
export function sessionNamespaceFor(sid) {
  if (!sid || sid === DEFAULT_NS) return DEFAULT_NS;
  if (/^dsh_v2_session_/.test(sid)) return sid;
  // Strip a legacy dsh_ prefix before re-prefixing to avoid dsh_v2_session_dsh_.
  const bare = sid.replace(/^dsh_/, "");
  return `${SESSION_NS_PREFIX}${bare}`;
}

/** identity.json accessors ------------------------------------------------- */

/** Default (empty) identity.json index object. */
export function emptyIdentityMap() {
  return { version: IDENTITY_VERSION, workspaces: [] };
}

/** Path of the identity.json index inside a dataDir. */
export function identityPath(dataDir) {
  return join(dataDir, IDENTITY_FILE_NAME);
}

/**
 * Load the identity.json index (returns an empty map when absent/corrupt).
 * @param {string} dataDir
 * @returns {{ version: number, workspaces: Array<object> }}
 */
export function loadIdentityMap(dataDir) {
  try {
    const raw = readFileSync(identityPath(dataDir), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyIdentityMap();
    if (!Array.isArray(parsed.workspaces)) parsed.workspaces = [];
    return parsed;
  } catch {
    return emptyIdentityMap();
  }
}

/**
 * Atomically write identity.json (tmp + rename in the same directory). Callers
 * are responsible for holding any broader lock (e.g. the memory lock).
 * @param {string} dataDir
 * @param {{ version: number, workspaces: Array<object> }} map
 */
export function saveIdentityMap(dataDir, map) {
  mkdirSync(dataDir, { recursive: true });
  const target = identityPath(dataDir);
  const tmpPath = join(dataDir, `.identity-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(map, null, 2), "utf8");
  try {
    renameSync(tmpPath, target);
  } catch {
    // Fall back to a plain overwrite (different filesystem or Windows rename
    // semantics); the window is single-writer because callers hold a lock.
    writeFileSync(target, readFileSync(tmpPath, "utf8"), "utf8");
    try { unlinkSync(tmpPath); } catch { /* best-effort */ }
  }
}

/**
 * Find a workspace entry by identity key.
 * @param {{ workspaces: Array<object> }} map
 * @param {string} identityKey
 * @returns {object | null}
 */
export function findWorkspaceEntry(map, identityKey) {
  if (!map?.workspaces) return null;
  return map.workspaces.find((w) => w.identityKey === identityKey) ?? null;
}

/**
 * Insert or update an identity.json workspace entry.
 * @param {string} dataDir
 * @param {{ identityKey: string, displayName?: string, canonicalPath?: string, lastSeenPath?: string, dshWorkspaceId?: string | null }} info
 * @returns {{ entry: object, created: boolean }}
 */
export function upsertWorkspaceEntry(dataDir, info) {
  const map = loadIdentityMap(dataDir);
  const existing = findWorkspaceEntry(map, info.identityKey);
  const key = info.identityKey;

  if (existing) {
    existing.lastSeenPath = canonicalize(info.canonicalPath) ?? info.lastSeenPath ?? existing.lastSeenPath;
    if (info.displayName) existing.displayName = info.displayName;
    if (info.dshWorkspaceId !== undefined) existing.dshWorkspaceId = info.dshWorkspaceId ?? null;
    saveIdentityMap(dataDir, map);
    return { entry: existing, created: false };
  }

  const namespace = workspaceNamespaceFor(key);
  const created = {
    identityKey: key,
    namespace,
    displayName: info.displayName ?? null,
    canonicalPath: canonicalize(info.canonicalPath) ?? info.canonicalPath ?? null,
    lastSeenPath: null,
    dshWorkspaceId: info.dshWorkspaceId ?? null,
    boundAt: Date.now(),
    proposedAt: null,
    declinedAt: null,
    supersededBy: null,
  };
  map.workspaces.push(created);
  saveIdentityMap(dataDir, map);
  return { entry: created, created: true };
}

/**
 * Resolve the memory context for the current request. This is the single
 * runtime entry (§9). H1-style constraints are enforced up the stack (the
 * runtime reconciles recallMode/autoWriteScope); here we only express state.
 *
 * Session mode → session namespace (or default).
 * Workspace mode + marker bound → the minted/lookup workspace namespace.
 * Workspace mode + no marker → explicit `bound:false, reason:"unbound"` with
 * `namespace: null` — the caller surfaces a bind hint rather than silently
 * falling back to another pool (never global, never process.cwd()).
 * @param {{ cwd?: string, sessionId?: string | null, config?: { recallMode?: string }, dataDir?: string }} param0
 * @returns {MemoryContext}
 */
export function resolveMemoryContext({ cwd, sessionId, config, dataDir }) {
  const mode = config?.recallMode === "workspace" ? "workspace" : "session";

  if (mode === "session") {
    const sid = sessionId || DEFAULT_NS;
    return {
      mode: "session",
      namespace: sessionNamespaceFor(sid),
      identityKey: null,
      source: "session",
      displayName: null,
      bound: true,
    };
  }

  // Workspace mode.
  const identity = resolveIdentity({ cwd });
  if (!identity) {
    return {
      mode: "workspace",
      namespace: null,
      identityKey: null,
      source: "unbound",
      displayName: null,
      bound: false,
      reason: "unbound",
    };
  }

  const map = loadIdentityMap(dataDir ?? DEFAULT_DATA_DIR);
  const entry = findWorkspaceEntry(map, identity.identityKey);
  if (entry) {
    return {
      mode: "workspace",
      namespace: entry.namespace,
      identityKey: entry.identityKey,
      source: "id",
      displayName: entry.displayName ?? basename(entry.canonicalPath ?? cwd),
      bound: true,
    };
  }

  // Marker valid but not yet registered in identity.json: adopt (register) it
  // at bind time; until then treat as unbound (no silent remap).
  return {
    mode: "workspace",
    namespace: null,
    identityKey: identity.identityKey,
    source: "id",
    displayName: basename(identity.canonicalPath),
    bound: false,
    reason: "unbound",
  };
}
