-- Run once in Supabase → SQL Editor (https://supabase.com/dashboard → SQL → New query)

create table if not exists public.tracker_state (
  key text primary key,
  value text not null default '[]',
  updated_at timestamptz not null default now()
);

alter table public.tracker_state enable row level security;

create policy "tracker_state_select"
  on public.tracker_state for select
  using (true);

create policy "tracker_state_insert"
  on public.tracker_state for insert
  with check (true);

create policy "tracker_state_update"
  on public.tracker_state for update
  using (true);

create policy "tracker_state_delete"
  on public.tracker_state for delete
  using (true);

-- Allow the publishable (anon) key to read/write this table
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.tracker_state to anon, authenticated;

-- Realtime: also enable in Dashboard → Database → Replication → tracker_state
alter publication supabase_realtime add table public.tracker_state;
