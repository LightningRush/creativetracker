import { createClient } from "@supabase/supabase-js";

const PROJECTS_KEY = "st_v10";
const SELECT_SETS_KEY = "ss_v1";
/** Shared delete tombstones — all clients must honor these on read/write */
const DELETED_KEY = "st_v10_deleted";

/** Prefer a recent local write while the cloud write may still be in flight */
const LOCAL_WRITE_GRACE_MS = 15000;

/** Concurrent creates from another tab still in flight (ms) */
const REMOTE_CREATE_GRACE_MS = 90000;

function asStoredString(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function projectTime(p) {
  if (!p) return 0;
  let t = Date.parse(p.updatedAt || "") || 0;
  const act = p.activity;
  if (Array.isArray(act)) {
    for (const a of act) {
      const at = Date.parse(a?.at || a?.time || a?.when || "") || 0;
      if (at > t) t = at;
    }
  }
  return t;
}

function parseDeletedMap(raw) {
  try {
    const v = JSON.parse(raw || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return v;
  } catch {
    return {};
  }
}

function pruneDeletedMap(map) {
  const cutoff = Date.now() - 90 * 86400000;
  const next = { ...map };
  for (const [id, at] of Object.entries(next)) {
    const t = Date.parse(at) || 0;
    if (t && t < cutoff) delete next[id];
  }
  return next;
}

/**
 * Write-path merge: local board is authoritative for membership + order.
 * Never keep remote-only IDs that are tombstoned. Only very fresh remote-only
 * cards are pulled in (concurrent create from another client).
 */
function mergeProjectLists(local, remote, deletedMap = {}) {
  if (!Array.isArray(local)) return Array.isArray(remote) ? remote : [];
  if (!Array.isArray(remote) || !remote.length) {
    return local.filter((p) => p?.id && !deletedMap[p.id]);
  }

  const remoteById = new Map();
  for (const p of remote) {
    if (p?.id && !deletedMap[p.id]) remoteById.set(p.id, p);
  }

  const localIds = new Set();
  const merged = [];

  for (const p of local) {
    if (!p?.id || deletedMap[p.id]) continue;
    localIds.add(p.id);
    const r = remoteById.get(p.id);
    if (!r) {
      merged.push(p);
      continue;
    }
    if (projectTime(p) >= projectTime(r)) {
      merged.push(p);
    } else {
      merged.push({
        ...r,
        stage: p.stage,
        boardOrder: p.boardOrder,
      });
    }
  }

  const now = Date.now();
  for (const r of remote) {
    if (!r?.id || localIds.has(r.id) || deletedMap[r.id]) continue;
    const t = projectTime(r);
    if (t && now - t < REMOTE_CREATE_GRACE_MS) merged.push(r);
  }

  return merged;
}

function stripDeletedFromProjectsJson(str, deletedMap) {
  if (!str || !deletedMap || !Object.keys(deletedMap).length) return { str, changed: false };
  try {
    const arr = JSON.parse(str);
    if (!Array.isArray(arr)) return { str, changed: false };
    const cleaned = arr.filter((p) => p?.id && !deletedMap[p.id]);
    if (cleaned.length === arr.length) return { str, changed: false };
    return { str: JSON.stringify(cleaned), changed: true };
  } catch {
    return { str, changed: false };
  }
}

function createLocalStorage() {
  return {
    async get(key) {
      const value = localStorage.getItem(key);
      return value !== null ? { value } : null;
    },
    async set(key, value) {
      localStorage.setItem(key, value);
    },
    async recordDeleted() {},
    async clearDeleted() {},
    subscribe() {
      return () => {};
    },
    mode: "local",
  };
}

function createSupabaseStorage(url, anonKey) {
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const TABLE = "tracker_state";
  const KEYS = [PROJECTS_KEY, SELECT_SETS_KEY];

  /** Latest value we intentionally wrote — keeps polls from clobbering mid-save */
  const lastLocalWrite = Object.create(null);
  let healChain = Promise.resolve();
  let deletedCache = { map: null, at: 0 };

  function scheduleHeal(key, value) {
    healChain = healChain
      .then(() => set(key, value))
      .catch((e) => console.error("[storage] heal push failed:", e?.message || e));
  }

  async function readDeletedMap({ bypassCache = false } = {}) {
    if (!bypassCache && deletedCache.map && Date.now() - deletedCache.at < 5000) {
      return deletedCache.map;
    }
    try {
      const { data } = await supabase
        .from(TABLE)
        .select("value")
        .eq("key", DELETED_KEY)
        .maybeSingle();
      const map = pruneDeletedMap(parseDeletedMap(asStoredString(data?.value)));
      deletedCache = { map, at: Date.now() };
      return map;
    } catch (e) {
      console.warn("[storage] deleted map read failed:", e?.message || e);
      return deletedCache.map || {};
    }
  }

  async function writeDeletedMap(map) {
    const cleaned = pruneDeletedMap(map);
    const str = JSON.stringify(cleaned);
    const updated_at = new Date().toISOString();
    deletedCache = { map: cleaned, at: Date.now() };

    const { data: existing, error: existErr } = await supabase
      .from(TABLE)
      .select("key")
      .eq("key", DELETED_KEY)
      .maybeSingle();
    if (existErr) throw existErr;

    if (existing?.key) {
      const { data, error } = await supabase
        .from(TABLE)
        .update({ value: str, updated_at })
        .eq("key", DELETED_KEY)
        .select("key")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Could not save delete list (RLS blocked UPDATE)");
    } else {
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ key: DELETED_KEY, value: str, updated_at })
        .select("key")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Could not save delete list (RLS blocked INSERT)");
    }
    return cleaned;
  }

  /** Record permanently deleted project IDs (shared across the team). */
  async function recordDeleted(ids) {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return;
    const map = await readDeletedMap({ bypassCache: true });
    const now = new Date().toISOString();
    for (const id of list) map[id] = now;
    await writeDeletedMap(map);
  }

  /** Undo a delete — allow these IDs back onto the board. */
  async function clearDeleted(ids) {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return;
    const map = await readDeletedMap({ bypassCache: true });
    let changed = false;
    for (const id of list) {
      if (map[id]) {
        delete map[id];
        changed = true;
      }
    }
    if (changed) await writeDeletedMap(map);
  }

  async function get(key) {
    const local = localStorage.getItem(key);

    const { data, error } = await supabase
      .from(TABLE)
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error) {
      console.error("[storage] Supabase read failed:", error.message);
      if (local) return { value: local, source: "local-fallback" };
      throw error;
    }

    const pending = lastLocalWrite[key];
    const pendingFresh =
      pending &&
      Date.now() - pending.at < LOCAL_WRITE_GRACE_MS &&
      pending.value;

    let remoteValue = asStoredString(data?.value);

    // Strip tombstoned cards from the board whenever we read it
    if (key === PROJECTS_KEY && remoteValue) {
      const deletedMap = await readDeletedMap();
      const stripped = stripDeletedFromProjectsJson(remoteValue, deletedMap);
      if (stripped.changed) {
        remoteValue = stripped.str;
        // Permanently clean cloud so resurrected deletes don't linger
        scheduleHeal(key, remoteValue);
      }
    }

    if (remoteValue) {
      if (pendingFresh && remoteValue !== pending.value) {
        return { value: pending.value, source: "local-pending" };
      }

      // Prefer cloud as source of truth. Do NOT re-push "fresher" localStorage —
      // that caused multi-user undo (stale tab overwrote the team board).
      localStorage.setItem(key, remoteValue);
      if (pending && remoteValue === pending.value) {
        delete lastLocalWrite[key];
      }
      return { value: remoteValue, source: "cloud" };
    }

    if (pendingFresh) {
      return { value: pending.value, source: "local-pending" };
    }

    // Cloud empty — seed once from local if present
    if (local) {
      scheduleHeal(key, local);
      return { value: local, source: "local-fallback" };
    }
    return null;
  }

  async function set(key, value) {
    let str = asStoredString(value);
    if (str == null) throw new Error("Invalid board data — cannot save");

    const isEmpty = !str || str === "[]" || str === "null";
    const protectAgainstWipe = key === PROJECTS_KEY || key === SELECT_SETS_KEY;
    if (protectAgainstWipe && isEmpty) {
      const { data } = await supabase.from(TABLE).select("value").eq("key", key).maybeSingle();
      if (data?.value != null && asStoredString(data.value) !== "[]") {
        console.warn("[storage] Blocked empty save — team data already exists for", key);
        throw new Error("Blocked empty save — refusing to wipe the team board");
      }
    }

    let deletedMap = {};
    if (key === PROJECTS_KEY) {
      deletedMap = await readDeletedMap();
      const stripped = stripDeletedFromProjectsJson(str, deletedMap);
      str = stripped.str;
    }

    // Merge with current cloud so a stale tab cannot wipe newer projects
    if (key === PROJECTS_KEY || key === SELECT_SETS_KEY) {
      try {
        const { data: cur } = await supabase
          .from(TABLE)
          .select("value")
          .eq("key", key)
          .maybeSingle();
        const remoteStr = asStoredString(cur?.value);
        if (remoteStr && remoteStr !== str) {
          const localArr = JSON.parse(str);
          const remoteArr = JSON.parse(remoteStr);
          if (Array.isArray(localArr) && Array.isArray(remoteArr)) {
            str = JSON.stringify(
              mergeProjectLists(localArr, remoteArr, key === PROJECTS_KEY ? deletedMap : {})
            );
          }
        }
      } catch (e) {
        console.warn("[storage] merge-before-write skipped:", e?.message || e);
      }
    }

    // Final strip after merge (remote-only fresh creates aren't tombstoned)
    if (key === PROJECTS_KEY) {
      str = stripDeletedFromProjectsJson(str, deletedMap).str;
    }

    const updated_at = new Date().toISOString();
    lastLocalWrite[key] = { value: str, at: Date.now() };
    localStorage.setItem(key, str);

    const { data: existing, error: existErr } = await supabase
      .from(TABLE)
      .select("key")
      .eq("key", key)
      .maybeSingle();

    if (existErr) {
      console.error("[storage] Supabase lookup failed:", existErr.message, existErr);
      throw new Error(existErr.message || "Could not reach team board");
    }

    if (existing?.key) {
      const { data: updated, error } = await supabase
        .from(TABLE)
        .update({ value: str, updated_at })
        .eq("key", key)
        .select("value")
        .maybeSingle();

      if (error) {
        console.error("[storage] Supabase save failed:", error.message, error);
        throw new Error(error.message || "Could not save to team board");
      }
      if (!updated) {
        console.error("[storage] UPDATE returned 0 rows — likely missing RLS UPDATE policy");
        throw new Error(
          "Save did not stick (Supabase blocked UPDATE on tracker_state). Run the SQL in supabase/schema.sql"
        );
      }
    } else {
      const { data: inserted, error } = await supabase
        .from(TABLE)
        .insert({ key, value: str, updated_at })
        .select("value")
        .maybeSingle();

      if (error) {
        console.error("[storage] Supabase save failed:", error.message, error);
        throw new Error(error.message || "Could not save to team board");
      }
      if (!inserted) {
        throw new Error(
          "Save did not stick (Supabase blocked INSERT on tracker_state). Run the SQL in supabase/schema.sql"
        );
      }
    }

    lastLocalWrite[key] = { value: str, at: Date.now() };
  }

  function subscribe(key, onValue) {
    let last = lastLocalWrite[key]?.value ?? localStorage.getItem(key);

    const applyIfChanged = (row) => {
      if (row?.value == null || row.value === last) return;
      if (row.source === "local-pending" || row.source === "local-newer") {
        last = row.value;
        return;
      }
      const pending = lastLocalWrite[key];
      if (
        pending &&
        Date.now() - pending.at < LOCAL_WRITE_GRACE_MS &&
        row.value !== pending.value
      ) {
        return;
      }
      last = row.value;
      onValue(row.value);
    };

    const channel = supabase
      .channel(`tracker_state:${key}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: TABLE,
          filter: `key=eq.${key}`,
        },
        async () => {
          try {
            applyIfChanged(await get(key));
          } catch {
            /* ignore */
          }
        }
      )
      .subscribe();

    const poll = setInterval(async () => {
      try {
        applyIfChanged(await get(key));
      } catch {
        /* ignore */
      }
    }, 3000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }

  /**
   * Only seed an EMPTY cloud from localStorage.
   * Never overwrite existing team data — that resurrected deleted cards
   * whenever a stale browser had a fatter board cached.
   */
  async function migrate() {
    for (const key of KEYS) {
      try {
        const local = localStorage.getItem(key);
        if (!local || local === "[]") continue;

        const { data } = await supabase
          .from(TABLE)
          .select("value")
          .eq("key", key)
          .maybeSingle();
        const remoteStr = asStoredString(data?.value);
        const remoteEmpty = !remoteStr || remoteStr === "[]";
        if (!remoteEmpty) continue;

        await set(key, local);
      } catch (e) {
        console.warn("[storage] migrate skipped for", key, e);
      }
    }
  }

  return {
    get,
    set,
    subscribe,
    migrate,
    recordDeleted,
    clearDeleted,
    mode: "shared",
  };
}

export function initStorage() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

  const storage =
    url && anonKey ? createSupabaseStorage(url, anonKey) : createLocalStorage();

  window.storage = storage;
  if (storage.mode !== "shared") {
    console.warn(
      "[storage] Running in LOCAL-ONLY mode — edits will not sync to the team board. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY on Vercel."
    );
  }
  return storage;
}

export { PROJECTS_KEY, SELECT_SETS_KEY, DELETED_KEY };
