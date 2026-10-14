create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  supabase_url text not null,
  publishable_key text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "Users can manage their own settings" on public.user_settings;
create policy "Users can manage their own settings"
  on public.user_settings
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_settings to authenticated;

create table if not exists public.ai_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null default 'gemini' check (provider = 'gemini'),
  model text not null check (model in ('gemini-3.1-flash-lite', 'gemini-3.5-flash-lite')),
  api_key text not null check (length(trim(api_key)) > 0),
  status text not null default 'untested' check (status in ('untested', 'active', 'error')),
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.ai_api_keys
  alter column user_id set default auth.uid();

create index if not exists ai_api_keys_user_created_idx
  on public.ai_api_keys (user_id, created_at, id);

alter table public.ai_api_keys enable row level security;

drop policy if exists "Users can manage their own Gemini API keys" on public.ai_api_keys;
create policy "Users can manage their own Gemini API keys"
  on public.ai_api_keys
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.ai_api_keys to authenticated;
