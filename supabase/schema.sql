-- Таблица подходов для облачной синхронизации.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить → Run.

create table if not exists public.sets (
  id uuid primary key,                       -- постоянный идентификатор подхода (создаёт приложение)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise text not null,
  reps integer not null check (reps >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  reason text,
  deleted boolean not null default false,    -- удалённые подходы остаются, чтобы удаление дошло до всех устройств
  updated_at timestamptz not null default now()
);

create index if not exists sets_user_updated on public.sets (user_id, updated_at);

-- Время изменения ставит сервер — так устройства с разными часами не теряют изменения.
create or replace function public.sets_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sets_touch_updated_at on public.sets;
create trigger sets_touch_updated_at
  before insert or update on public.sets
  for each row execute function public.sets_touch_updated_at();

-- Каждый видит и меняет только свои подходы.
alter table public.sets enable row level security;

drop policy if exists "Свои подходы: чтение" on public.sets;
create policy "Свои подходы: чтение" on public.sets
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Свои подходы: добавление" on public.sets;
create policy "Свои подходы: добавление" on public.sets
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Свои подходы: изменение" on public.sets;
create policy "Свои подходы: изменение" on public.sets
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update on public.sets to authenticated;

-- Профили «Я» / «Kids» (добавлено позже; безопасно выполнять повторно).
alter table public.sets add column if not exists profile text not null default 'me';
