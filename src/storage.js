import { createClient } from "@supabase/supabase-js";

const PROJECTS_KEY = "st_v10";
const SELECT_SETS_KEY = "ss_v1";

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

    if (data?.value) {
      localStorage.setItem(key, data.value);
      return { value: data.value, source: "cloud" };
    }

    const local = localStorage.getItem(key);
    if (local) return { value: local, source: "local-fallback" };
    return null;
  }

  async function set(key, value) {
    const isEmpty = !value || value === "[]" || value === "null";
    const protectAgainstWipe = key === PROJECTS_KEY || key === SELECT_SETS_KEY;
    if (protectAgainstWipe && isEmpty) {
      const { data } = await supabase.from(TABLE).select("value").eq("key", key).maybeSingle();
      if (data?.value && data.value !== "[]") {
        console.warn("[storage] Blocked empty save — team data already exists for", key);
        return;
      }
    }

    localStorage.setItem(key, value);

    const { error } = await supabase.from(TABLE).upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

    if (error) {
      console.error("[storage] Supabase save failed:", error.message, error);
      throw new Error(error.message || "Could not save to team board");
    }
  }

  function subscribe(key, onValue) {
    let last = localStorage.getItem(key);

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
            const row = await get(key);
            if (row?.value != null && row.value !== last) {
              last = row.value;
              onValue(row.value);
            }
          } catch {
            /* ignore */
          }
        }
      )
      .subscribe();

    const poll = setInterval(async () => {
      try {
        const row = await get(key);
        if (row?.value != null && row.value !== last) {
          last = row.value;
          onValue(row.value);
        }
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
