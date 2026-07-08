create table if not exists public.event_winners (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  tier text default '',
  prize text default '',
  telegram text not null,
  twitter text default '',
  note text default '',
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

create index if not exists event_winners_event_idx on public.event_winners(event);

alter table public.event_winners enable row level security;

drop policy if exists "ew public read" on public.event_winners;
create policy "ew public read" on public.event_winners
  for select using (true);

drop policy if exists "ew admin insert" on public.event_winners;
create policy "ew admin insert" on public.event_winners
  for insert
  with check (exists(
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin
  ));

drop policy if exists "ew admin update" on public.event_winners;
create policy "ew admin update" on public.event_winners
  for update
  using (exists(
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin
  ));

drop policy if exists "ew admin delete" on public.event_winners;
create policy "ew admin delete" on public.event_winners
  for delete
  using (exists(
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin
  ));
