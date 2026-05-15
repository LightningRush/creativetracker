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
  const supabase = createClient(url, anonKey);
  const TABLE = "tracker_state";
  const KEYS = [PROJECTS_KEY, SELECT_SETS_KEY];

  async function get(key) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error) throw error;
    return data ? { value: data.value } : null;
  }

  async function set(key, value) {
    const { error } = await supabase.from(TABLE).upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    if (error) throw error;
  }

  function subscribe(key, onValue) {
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
            if (row?.value != null) onValue(row.value);
          } catch {
            /* ignore poll/subscribe errors */
          }
        }
      )
      .subscribe();

    const poll = setInterval(async () => {
      try {
        const row = await get(key);
        if (row?.value != null) onValue(row.value);
      } catch {
        /* ignore */
      }
    }, 5000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }

  /** Upload browser-only data to Supabase when the cloud row is empty. */
  async function migrate() {
    for (const key of KEYS) {
      const local = localStorage.getItem(key);
      if (!local || local === "[]") continue;

      const remote = await get(key);
      const remoteEmpty = !remote?.value || remote.value === "[]";
      if (!remoteEmpty) continue;

      await set(key, local);
    }
  }

  return { get, set, subscribe, migrate, mode: "shared" };
}

/** Initialize window.storage — shared DB when Supabase env vars exist, else localStorage. */
export function initStorage() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const storage =
    url && anonKey ? createSupabaseStorage(url, anonKey) : createLocalStorage();

  window.storage = storage;
  return storage;
}

export { PROJECTS_KEY, SELECT_SETS_KEY };
