-- Shared dashboard work/messages. Run once in the Supabase SQL Editor.
create table if not exists public.dashboard_work_messages (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(trim(body)) between 1 and 500),
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Team member',
  parent_id uuid references public.dashboard_work_messages(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists dashboard_work_messages_created_at_idx
  on public.dashboard_work_messages (created_at desc);
create index if not exists dashboard_work_messages_parent_id_idx
  on public.dashboard_work_messages (parent_id);

alter table public.dashboard_work_messages enable row level security;

drop policy if exists "Approved users can read workboard" on public.dashboard_work_messages;
create policy "Approved users can read workboard"
  on public.dashboard_work_messages for select to authenticated using (true);

drop policy if exists "Approved users can post workboard messages" on public.dashboard_work_messages;
create policy "Approved users can post workboard messages"
  on public.dashboard_work_messages for insert to authenticated
  with check (author_id = auth.uid());

-- The dashboard is intentionally a shared clean-up board: any signed-in user
-- can remove a completed or no-longer-needed task/reply.
drop policy if exists "Approved users can delete workboard messages" on public.dashboard_work_messages;
create policy "Approved users can delete workboard messages"
  on public.dashboard_work_messages for delete to authenticated using (true);
