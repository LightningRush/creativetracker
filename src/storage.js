import { createClient } from "@supabase/supabase-js";

const PROJECTS_KEY = "st_v10";
const SELECT_SETS_KEY = "ss_v1";

/** Prefer a recent local write while the cloud upsert may still be in flight */
const LOCAL_WRITE_GRACE_MS = 8000;

function asStoredString(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
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

  async function get(key) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error) {
      console.error("[storage] Supabase read failed:", error.message);
      const local = localStorage.getItem(key);
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
      // Cloud still has older data while our write is in flight — keep local
      if (pendingFresh && remoteValue !== pending.value) {
        return { value: pending.value, source: "local-pending" };
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

    const local = localStorage.getItem(key);
    if (local) return { value: local, source: "local-fallback" };
    return null;
  }

  async function set(key, value) {
    const str = asStoredString(value);
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

    const updated_at = new Date().toISOString();
    lastLocalWrite[key] = { value: str, at: Date.now() };
    localStorage.setItem(key, str);

    // Prefer update-then-insert so we don't depend on upsert/onConflict setup
    const { data: existing, error: existErr } = await supabase
      .from(TABLE)
      .select("key")
      .eq("key", key)
      .maybeSingle();

    if (existErr) {
      console.error("[storage] Supabase lookup failed:", existErr.message, existErr);
      throw new Error(existErr.message || "Could not reach team board");
    }

    let writeErr = null;
    if (existing?.key) {
      const { error } = await supabase
        .from(TABLE)
        .update({ value: str, updated_at })
        .eq("key", key);
      writeErr = error;
    } else {
      const { error } = await supabase
        .from(TABLE)
        .insert({ key, value: str, updated_at });
      writeErr = error;
    }

    if (writeErr) {
      console.error("[storage] Supabase save failed:", writeErr.message, writeErr);
      throw new Error(writeErr.message || "Could not save to team board");
    }

    // Verify the cloud actually has what we wrote (catches RLS "success" no-ops)
    const { data: check, error: checkErr } = await supabase
      .from(TABLE)
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (checkErr) {
      console.error("[storage] Save verify failed:", checkErr.message, checkErr);
      throw new Error(checkErr.message || "Could not verify team board save");
    }

    const checkVal = asStoredString(check?.value);
    if (checkVal !== str) {
      console.error("[storage] Save verify mismatch — cloud did not keep our write");
      throw new Error(
        "Save did not stick on the team board (check Supabase RLS UPDATE policy for tracker_state)"
      );
    }

    lastLocalWrite[key] = { value: str, at: Date.now() };
  }

  function subscribe(key, onValue) {
    let last = lastLocalWrite[key]?.value ?? localStorage.getItem(key);

    const applyIfChanged = (row) => {
      if (row?.value == null || row.value === last) return;
      if (row.source === "local-pending") {
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

  async function migrate() {
    for (const key of KEYS) {
      try {
        const local = localStorage.getItem(key);
        if (!local || local === "[]") continue;

        const remote = await get(key);
        const remoteEmpty = !remote?.value || remote.value === "[]";
        if (!remoteEmpty) continue;

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
  return storage;
}

export { PROJECTS_KEY, SELECT_SETS_KEY };
