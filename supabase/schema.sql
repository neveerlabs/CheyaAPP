create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  supabase_url text not null default '',
  publishable_key text not null default '',
  display_name text not null default '',
  custom_prompt text not null default '',
  chat_style text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.user_settings
  alter column supabase_url set default '',
  alter column publishable_key set default '',
  add column if not exists display_name text not null default '',
  add column if not exists custom_prompt text not null default '',
  add column if not exists chat_style text not null default '';

update public.user_settings
set supabase_url = '', publishable_key = ''
where supabase_url <> '' or publishable_key <> '';

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
  created_at timestamptz not null default now(),
  constraint chat_messages_user_id_id_key unique (user_id, id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_messages'::regclass
      and conname = 'chat_messages_user_id_id_key'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_user_id_id_key unique (user_id, id);
  end if;
end;
$$;

drop index if exists public.chat_messages_user_id_id_idx;

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

alter table public.chat_messages
  add column if not exists version_number integer not null default 1,
  add column if not exists thinking_summary text,
  add column if not exists is_active boolean not null default true,
  add column if not exists revision_reason text not null default 'initial'
    check (revision_reason in ('initial', 'user_edit', 'regenerate', 'ai_update'));

create index if not exists chat_messages_user_active_created_idx
  on public.chat_messages (user_id, is_active, created_at, id);

create table if not exists public.chat_message_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_id uuid not null,
  version_number integer not null check (version_number >= 1),
  content text not null check (length(trim(content)) > 0 and length(content) <= 50000),
  embedding extensions.vector(768),
  thinking_summary text,
  revision_reason text not null check (
    revision_reason in ('initial', 'user_edit', 'regenerate', 'ai_update')
  ),
  created_at timestamptz not null default now(),
  unique (user_id, message_id, version_number),
  foreign key (user_id, message_id)
    references public.chat_messages (user_id, id)
    on delete cascade
);

create index if not exists chat_message_versions_user_message_idx
  on public.chat_message_versions (user_id, message_id, version_number);

alter table public.chat_message_versions enable row level security;

drop policy if exists "Users can read their own message versions" on public.chat_message_versions;
create policy "Users can read their own message versions"
  on public.chat_message_versions
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.chat_message_versions to authenticated;

insert into public.chat_message_versions (
  user_id,
  message_id,
  version_number,
  content,
  embedding,
  thinking_summary,
  revision_reason
)
select
  messages.user_id,
  messages.id,
  messages.version_number,
  messages.content,
  messages.embedding,
  messages.thinking_summary,
  messages.revision_reason
from public.chat_messages as messages
on conflict (user_id, message_id, version_number) do nothing;

create or replace function public.record_chat_message_version()
returns trigger
language plpgsql
security invoker
set search_path = public, auth
as $$
begin
  if tg_op = 'UPDATE' then
    if new.content is distinct from old.content
      or new.embedding is distinct from old.embedding
      or new.thinking_summary is distinct from old.thinking_summary
      or new.revision_reason is distinct from old.revision_reason then
      new.version_number := old.version_number + 1;
    else
      new.version_number := old.version_number;
      return new;
    end if;
  else
    new.version_number := greatest(new.version_number, 1);
  end if;
  return new;
end;
$$;

drop trigger if exists chat_messages_set_version_number on public.chat_messages;
create trigger chat_messages_set_version_number
  before insert or update on public.chat_messages
  for each row execute function public.record_chat_message_version();

create or replace function public.store_chat_message_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_message_versions (
    user_id,
    message_id,
    version_number,
    content,
    embedding,
    thinking_summary,
    revision_reason
  )
  values (
    new.user_id,
    new.id,
    new.version_number,
    new.content,
    new.embedding,
    new.thinking_summary,
    new.revision_reason
  )
  on conflict (user_id, message_id, version_number) do nothing;
  return new;
end;
$$;

drop trigger if exists chat_messages_store_version on public.chat_messages;
create trigger chat_messages_store_version
  after insert or update on public.chat_messages
  for each row execute function public.store_chat_message_version();

create or replace function public.revise_chat_message(
  p_message_id uuid,
  p_content text,
  p_embedding extensions.vector(768),
  p_thinking_summary text,
  p_revision_reason text,
  p_branch boolean default true
)
returns setof public.chat_messages
language plpgsql
security invoker
set search_path = public, extensions, auth
as $$
declare
  target public.chat_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  if p_revision_reason not in ('user_edit', 'regenerate', 'ai_update') then
    raise exception 'Invalid message revision reason.';
  end if;
  if length(trim(p_content)) = 0 or length(p_content) > 50000 then
    raise exception 'Message content must be between 1 and 50000 characters.';
  end if;

  select * into target
  from public.chat_messages
  where id = p_message_id
    and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Message not found.';
  end if;

  if p_branch then
    update public.chat_messages
    set is_active = false
    where user_id = auth.uid()
      and is_active
      and (created_at, id) > (target.created_at, target.id);
  end if;

  return query
  update public.chat_messages
  set content = p_content,
      embedding = p_embedding,
      thinking_summary = p_thinking_summary,
      revision_reason = p_revision_reason,
      is_active = true
  where id = p_message_id
    and user_id = auth.uid()
  returning *;
end;
$$;

grant execute on function public.revise_chat_message(
  uuid,
  text,
  extensions.vector,
  text,
  text,
  boolean
) to authenticated;

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
  version_number integer not null default 1,
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

alter table public.message_feedback
  add column if not exists version_number integer not null default 1;

drop index if exists public.message_feedback_user_message_kind_idx;
drop index if exists public.message_feedback_user_message_version_kind_idx;

with ranked_ratings as (
  select
    id,
    row_number() over (
      partition by user_id, message_id, version_number
      order by created_at desc, id desc
    ) as rating_order
  from public.message_feedback
  where kind in ('like', 'dislike')
)
delete from public.message_feedback as feedback
using ranked_ratings
where feedback.id = ranked_ratings.id
  and ranked_ratings.rating_order > 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.message_feedback'::regclass
      and conname = 'message_feedback_version_fk'
  ) then
    alter table public.message_feedback
      add constraint message_feedback_version_fk
      foreign key (user_id, message_id, version_number)
      references public.chat_message_versions (user_id, message_id, version_number)
      on delete cascade;
  end if;
end;
$$;

create unique index if not exists message_feedback_user_message_version_kind_idx
  on public.message_feedback (user_id, message_id, version_number)
  where kind in ('like', 'dislike');

alter table public.message_feedback enable row level security;

drop policy if exists "Users can manage their own message feedback" on public.message_feedback;
create policy "Users can manage their own message feedback"
  on public.message_feedback
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.message_feedback to authenticated;

create or replace function public.set_message_rating(
  p_message_id uuid,
  p_version_number integer,
  p_rating text
)
returns void
language plpgsql
security invoker
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to rate a message.';
  end if;

  if p_rating not in ('like', 'dislike') and p_rating is not null then
    raise exception 'Rating must be like, dislike, or null.';
  end if;

  delete from public.message_feedback
  where user_id = auth.uid()
    and message_id = p_message_id
    and version_number = p_version_number
    and kind in ('like', 'dislike');

  if p_rating is not null then
    insert into public.message_feedback (message_id, version_number, kind)
    values (p_message_id, p_version_number, p_rating);
  end if;
end;
$$;

grant execute on function public.set_message_rating(uuid, integer, text) to authenticated;

create or replace function public.import_account_data(p_data jsonb)
returns table (imported integer)
language plpgsql
security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  imported_rows integer := 0;
  inserted_rows integer;
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'A signed-in account is required to import browser data.';
  end if;
  if p_data is null
    or jsonb_typeof(p_data) is distinct from 'object'
    or octet_length(p_data::text) > 20000000 then
    raise exception 'The account data import must be an object smaller than 20 MB.';
  end if;

  insert into public.user_settings (
    user_id, supabase_url, publishable_key, display_name, custom_prompt, chat_style, updated_at
  )
  select
    auth.uid(), '', '',
    coalesce(incoming.display_name, ''), coalesce(incoming.custom_prompt, ''),
    coalesce(incoming.chat_style, ''), coalesce(incoming.updated_at, now())
  from jsonb_to_record(p_data -> 'user_settings') as incoming(
    supabase_url text,
    publishable_key text,
    display_name text,
    custom_prompt text,
    chat_style text,
    updated_at timestamptz
  )
  where jsonb_typeof(p_data -> 'user_settings') = 'object'
  on conflict (user_id) do update
    set supabase_url = excluded.supabase_url,
        publishable_key = excluded.publishable_key,
        display_name = excluded.display_name,
        custom_prompt = excluded.custom_prompt,
        chat_style = excluded.chat_style,
        updated_at = excluded.updated_at
    where excluded.updated_at > public.user_settings.updated_at;
  get diagnostics inserted_rows = row_count;
  imported_rows := imported_rows + inserted_rows;

  insert into public.ai_api_keys (
    id, user_id, provider, model, api_key, status, last_error, created_at
  )
  select id, auth.uid(), provider, model, api_key, status, last_error, created_at
  from jsonb_to_recordset(coalesce(p_data -> 'ai_api_keys', '[]'::jsonb)) as incoming(
    id uuid, provider text, model text, api_key text, status text,
    last_error text, created_at timestamptz
  )
  on conflict do nothing;
  get diagnostics inserted_rows = row_count;
  imported_rows := imported_rows + inserted_rows;

  insert into public.chat_messages (
    id, user_id, role, content, embedding, created_at, version_number,
    thinking_summary, is_active, revision_reason
  )
  select
    id, auth.uid(), role, content, embedding, created_at, version_number,
    thinking_summary, is_active, revision_reason
  from jsonb_to_recordset(coalesce(p_data -> 'chat_messages', '[]'::jsonb)) as incoming(
    id uuid, role text, content text, embedding extensions.vector(768),
    created_at timestamptz, version_number integer, thinking_summary text,
    is_active boolean, revision_reason text
  )
  on conflict do nothing;
  get diagnostics inserted_rows = row_count;
  imported_rows := imported_rows + inserted_rows;

  insert into public.chat_message_versions (
    id, user_id, message_id, version_number, content, embedding,
    thinking_summary, revision_reason, created_at
  )
  select
    id, auth.uid(), message_id, version_number, content, embedding,
    thinking_summary, revision_reason, created_at
  from jsonb_to_recordset(coalesce(p_data -> 'chat_message_versions', '[]'::jsonb)) as incoming(
    id uuid, message_id uuid, version_number integer, content text,
    embedding extensions.vector(768), thinking_summary text,
    revision_reason text, created_at timestamptz
  )
  on conflict do nothing;
  get diagnostics inserted_rows = row_count;
  imported_rows := imported_rows + inserted_rows;

  insert into public.message_insights (
    id, user_id, message_id, mood, communication_style, situation,
    topics, support_needs, summary, created_at
  )
  select
    id, auth.uid(), message_id, mood, communication_style, situation,
    topics, support_needs, summary, created_at
  from jsonb_to_recordset(coalesce(p_data -> 'message_insights', '[]'::jsonb)) as incoming(
    id uuid, message_id uuid, mood text, communication_style text,
    situation text, topics text[], support_needs text, summary text,
    created_at timestamptz
  )
  on conflict do nothing;
  get diagnostics inserted_rows = row_count;
  imported_rows := imported_rows + inserted_rows;

  insert into public.user_memories (
    id, user_id, category, content, embedding, created_at, updated_at
  )
  select
    id, auth.uid(), category, content, embedding, created_at, updated_at
  from jsonb_to_recordset(coalesce(p_data -> 'user_memories', '[]'::jsonb)) as incoming(
    id uuid, category text, content text, embedding extensions.vector(768),
    created_at timestamptz, updated_at timestamptz
  )
  on conflict do nothing;
  get diagnostics inserted_rows = row_count;
  imported_rows := imported_rows + inserted_rows;

  insert into public.message_feedback (
    id, user_id, message_id, version_number, kind, details, created_at
  )
  select
    id, auth.uid(), message_id, version_number, kind, details, created_at
  from jsonb_to_recordset(coalesce(p_data -> 'message_feedback', '[]'::jsonb)) as incoming(
    id uuid, message_id uuid, version_number integer, kind text,
    details text, created_at timestamptz
  )
  on conflict do nothing;
  get diagnostics inserted_rows = row_count;
  imported_rows := imported_rows + inserted_rows;

  return query select imported_rows;
end;
$$;

revoke all on function public.import_account_data(jsonb) from public, anon;
grant execute on function public.import_account_data(jsonb) to authenticated;

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
    and messages.is_active
    and messages.embedding is not null
    and messages.id is distinct from exclude_message_id
  order by messages.embedding <=> query_embedding
  limit least(greatest(result_limit, 1), 20);
$$;

create or replace function public.match_chat_messages_before(
  query_embedding extensions.vector(768),
  max_created_at timestamptz,
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
    and messages.is_active
    and messages.embedding is not null
    and messages.created_at < max_created_at
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
grant execute on function public.match_chat_messages_before(extensions.vector, timestamptz, integer, uuid) to authenticated;
grant execute on function public.match_user_memories(extensions.vector, integer) to authenticated;
grant usage on schema extensions to authenticated;
