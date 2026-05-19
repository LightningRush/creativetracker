-- Run this in Supabase SQL Editor if projects disappear after refresh

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.tracker_state to anon, authenticated;

create policy "tracker_state_delete"
  on public.tracker_state for delete
  using (true);
