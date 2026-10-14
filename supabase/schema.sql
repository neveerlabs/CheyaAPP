create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  supabase_url text not null,
  publishable_key text not null,
  display_name text not null default '',
  custom_prompt text not null default '',
  chat_style text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.user_settings
  add column if not exists display_name text not null default '',
  add column if not exists custom_prompt text not null default '',
  add column if not exists chat_style text not null default '';

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

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

do $$
begin
  if exists (
    select 1
    from pg_extension as ext
    join pg_namespace as ns on ns.oid = ext.extnamespace
    where ext.extname = 'vector'
      and ns.nspname <> 'extensions'
  ) then
    execute 'alter extension vector set schema extensions';
  end if;
end;
$$;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(trim(content)) > 0 and length(content) <= 50000),
  embedding extensions.vector(768),
  created_at timestamptz not null default now()
);

create unique index if not exists chat_messages_user_id_id_idx
  on public.chat_messages (user_id, id);

create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);

create index if not exists chat_messages_embedding_idx
  on public.chat_messages using hnsw (embedding extensions.vector_cosine_ops);

alter table public.chat_messages enable row level security;

drop policy if exists "Users can manage their own chat messages" on public.chat_messages;
create policy "Users can manage their own chat messages"
  on public.chat_messages
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.chat_messages to authenticated;

create table if not exists public.message_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_id uuid not null unique,
  mood text not null default '',
  communication_style text not null default '',
  situation text not null default '',
  topics text[] not null default '{}',
  support_needs text not null default '',
  summary text not null default '',
  created_at timestamptz not null default now(),
  foreign key (user_id, message_id)
    references public.chat_messages (user_id, id)
    on delete cascade
);

do $$
declare
  existing_foreign_key record;
begin
  for existing_foreign_key in
    select constraint_row.conname
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.message_insights'::regclass
      and constraint_row.confrelid = 'public.chat_messages'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.conname <> 'message_insights_user_message_fk'
  loop
    execute format(
      'alter table public.message_insights drop constraint %I',
      existing_foreign_key.conname
    );
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.message_insights'::regclass
      and conname = 'message_insights_user_message_fk'
  ) then
    alter table public.message_insights
      add constraint message_insights_user_message_fk
      foreign key (user_id, message_id)
      references public.chat_messages (user_id, id)
      on delete cascade;
  end if;
end;
$$;

create index if not exists message_insights_user_created_idx
  on public.message_insights (user_id, created_at desc);

alter table public.message_insights enable row level security;

drop policy if exists "Users can manage their own message insights" on public.message_insights;
create policy "Users can manage their own message insights"
  on public.message_insights
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.message_insights to authenticated;

create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null default 'general',
  content text not null check (length(trim(content)) > 0 and length(content) <= 10000),
  embedding extensions.vector(768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_memories_user_updated_idx
  on public.user_memories (user_id, updated_at desc);

create index if not exists user_memories_embedding_idx
  on public.user_memories using hnsw (embedding extensions.vector_cosine_ops);

alter table public.user_memories enable row level security;

drop policy if exists "Users can manage their own memories" on public.user_memories;
create policy "Users can manage their own memories"
  on public.user_memories
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_memories to authenticated;

create table if not exists public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_id uuid not null,
  kind text not null check (kind in ('like', 'dislike', 'report')),
  details text,
  created_at timestamptz not null default now(),
  foreign key (user_id, message_id)
    references public.chat_messages (user_id, id)
    on delete cascade,
  check (
    (kind = 'report' and length(trim(coalesce(details, ''))) > 0)
    or (kind in ('like', 'dislike') and details is null)
  )
);

create unique index if not exists message_feedback_user_message_kind_idx
  on public.message_feedback (user_id, message_id, kind);

alter table public.message_feedback enable row level security;

drop policy if exists "Users can manage their own message feedback" on public.message_feedback;
create policy "Users can manage their own message feedback"
  on public.message_feedback
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.message_feedback to authenticated;

create or replace function public.match_chat_messages(
  query_embedding extensions.vector(768),
  result_limit integer default 8,
  exclude_message_id uuid default null
)
returns table (
  id uuid,
  role text,
  content text,
  created_at timestamptz,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions, auth
as $$
  select
    messages.id,
    messages.role,
    messages.content,
    messages.created_at,
    1 - (messages.embedding <=> query_embedding) as similarity
  from public.chat_messages as messages
  where messages.user_id = auth.uid()
    and messages.embedding is not null
    and messages.id is distinct from exclude_message_id
  order by messages.embedding <=> query_embedding
  limit least(greatest(result_limit, 1), 20);
$$;

create or replace function public.match_user_memories(
  query_embedding extensions.vector(768),
  result_limit integer default 6
)
returns table (
  id uuid,
  category text,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions, auth
as $$
  select
    memories.id,
    memories.category,
    memories.content,
    1 - (memories.embedding <=> query_embedding) as similarity
  from public.user_memories as memories
  where memories.user_id = auth.uid()
    and memories.embedding is not null
  order by memories.embedding <=> query_embedding
  limit least(greatest(result_limit, 1), 20);
$$;

grant execute on function public.match_chat_messages(extensions.vector, integer, uuid) to authenticated;
grant execute on function public.match_user_memories(extensions.vector, integer) to authenticated;
grant usage on schema extensions to authenticated;
