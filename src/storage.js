import { createClient } from "@supabase/supabase-js";

const PROJECTS_KEY = "st_v10";
const SELECT_SETS_KEY = "ss_v1";

/** Prefer a recent local write while the cloud write may still be in flight */
const LOCAL_WRITE_GRACE_MS = 15000;

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

/** How "new" a stored board blob is (max project time + count) */
function boardScore(raw) {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      return { max: 0, count: 0, len: String(raw || "").length };
    }
    let max = 0;
    for (const p of data) {
      const t = projectTime(p);
      if (t > max) max = t;
    }
    return { max, count: data.length, len: String(raw).length };
  } catch {
    return { max: 0, count: 0, len: String(raw || "").length };
  }
}

function isFresher(candidate, baseline) {
  if (!candidate) return false;
  if (!baseline) return true;
  if (candidate === baseline) return false;
  const a = boardScore(candidate);
  const b = boardScore(baseline);
  if (a.max !== b.max) return a.max > b.max;
  if (a.count !== b.count) return a.count > b.count;
  return a.len > b.len;
}

/** Per-project merge — newer updatedAt wins; keeps creates from either side */
function mergeProjectLists(local, remote) {
  if (!Array.isArray(remote)) return Array.isArray(local) ? local : [];
  if (!Array.isArray(local) || !local.length) return remote;

  const byId = new Map();
  for (const p of remote) {
    if (p?.id) byId.set(p.id, p);
  }
  for (const p of local) {
    if (!p?.id) continue;
    const r = byId.get(p.id);
    if (!r || projectTime(p) >= projectTime(r)) byId.set(p.id, p);
  }

  const used = new Set();
  const merged = [];
  for (const p of remote) {
    if (!p?.id || used.has(p.id)) continue;
    merged.push(byId.get(p.id) || p);
    used.add(p.id);
  }
  for (const p of local) {
    if (!p?.id || used.has(p.id)) continue;
    merged.push(byId.get(p.id) || p);
    used.add(p.id);
  }
  return merged;
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

  function scheduleHeal(key, value) {
    healChain = healChain
      .then(() => set(key, value))
      .catch((e) => console.error("[storage] heal push failed:", e?.message || e));
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

    const remoteValue = asStoredString(data?.value);

    if (remoteValue) {
      if (pendingFresh && remoteValue !== pending.value) {
        return { value: pending.value, source: "local-pending" };
      }

      // After refresh, memory pending is gone — but localStorage may still be newer
      // than a cloud row that never stuck (or was overwritten). Keep local & re-push.
      if (local && isFresher(local, remoteValue)) {
        lastLocalWrite[key] = { value: local, at: Date.now() };
        scheduleHeal(key, local);
        return { value: local, source: "local-newer" };
      }

      localStorage.setItem(key, remoteValue);
      if (pending && remoteValue === pending.value) {
        delete lastLocalWrite[key];
      }
      return { value: remoteValue, source: "cloud" };
    }

    if (pendingFresh) {
      return { value: pending.value, source: "local-pending" };
    }

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
            str = JSON.stringify(mergeProjectLists(localArr, remoteArr));
          }
        }
      } catch (e) {
        console.warn("[storage] merge-before-write skipped:", e?.message || e);
      }
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
      // .select() after update: if RLS blocks, data is null with no error
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
      // Don't let an older poll overwrite a fresher in-memory board
      if (last && isFresher(last, row.value)) return;
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
        if (!remoteEmpty && !isFresher(local, remoteStr)) continue;

        await set(key, local);
      } catch (e) {
        console.warn("[storage] migrate skipped for", key, e);
      }
    }
  }

  return { get, set, subscribe, migrate, mode: "shared" };
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

export { PROJECTS_KEY, SELECT_SETS_KEY };
