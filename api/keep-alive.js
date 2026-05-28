import { createClient } from "@supabase/supabase-js";

/**
 * Vercel Cron keep-alive: hits tracker_state so Supabase free tier stays active.
 * Secured with CRON_SECRET (Vercel sends Authorization: Bearer <CRON_SECRET>).
 */
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!url?.trim() || !anonKey?.trim()) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase URL or anon key (set VITE_SUPABASE_* or SUPABASE_* on Vercel)",
    });
  }

  const supabase = createClient(url.trim(), anonKey.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("tracker_state")
    .select("key, updated_at")
    .limit(10);

  if (error) {
    return res.status(502).json({ ok: false, error: error.message });
  }

  return res.status(200).json({
    ok: true,
    pingedAt: new Date().toISOString(),
    keys: (data || []).map((r) => r.key),
  });
}
