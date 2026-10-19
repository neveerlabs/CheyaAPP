create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  supabase_url text not null default '',
  publishable_key text not null default '',
  display_name text not null default '',
  custom_prompt text not null default '',
  chat_style text not null default '',
  tts_api_key text not null default '',
  tts_api_keys jsonb not null default '[]'::jsonb,
  tts_voice text not null default 'Kore',
  updated_at timestamptz not null default now()
);

alter table public.user_settings
  alter column supabase_url set default '',
  alter column publishable_key set default '',
  add column if not exists display_name text not null default '',
  add column if not exists custom_prompt text not null default '',
  add column if not exists chat_style text not null default '',
  add column if not exists tts_api_key text not null default '',
  add column if not exists tts_api_keys jsonb not null default '[]'::jsonb,
  add column if not exists tts_voice text not null default 'Kore';

update public.user_settings
set tts_api_keys = jsonb_build_array(tts_api_key)
where tts_api_keys = '[]'::jsonb and length(trim(tts_api_key)) > 0;

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

create table if not exists public.chat_tts_audio_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  message_id uuid not null,
  version_number integer not null check (version_number >= 1),
  voice text not null check (voice in (
    'Kore', 'Aoede', 'Leda', 'Callirrhoe', 'Achernar',
    'Vindemiatrix', 'Sulafat', 'Erinome', 'Laomedeia'
  )),
  storage_path text unique,
  source text not null default 'gemini' check (source in ('gemini', 'browser')),
  browser_voice_name text,
  error_details text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  unique (user_id, message_id, version_number, voice)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_tts_audio_cache'::regclass
      and conname = 'chat_tts_audio_cache_user_id_fkey'
  ) then
    delete from public.chat_tts_audio_cache as cache
    where not exists (
      select 1 from auth.users as account where account.id = cache.user_id
    );
    alter table public.chat_tts_audio_cache
      add constraint chat_tts_audio_cache_user_id_fkey
      foreign key (user_id)
      references auth.users (id)
      on delete cascade;
  end if;
end;
$$;

create table if not exists public.account_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  origin text not null,
  path text not null,
  user_agent text not null default '',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default false
);

alter table public.account_sessions
  add column if not exists is_active boolean not null default false;

create index if not exists account_sessions_user_last_seen_idx
  on public.account_sessions (user_id, last_seen_at desc);

alter table public.account_sessions enable row level security;
drop policy if exists "Users can read their own account sessions" on public.account_sessions;
create policy "Users can read their own account sessions"
  on public.account_sessions for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can register their own account sessions" on public.account_sessions;
create policy "Users can register their own account sessions"
  on public.account_sessions for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "Users can update their own account sessions" on public.account_sessions;
create policy "Users can update their own account sessions"
  on public.account_sessions for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own account sessions" on public.account_sessions;
create policy "Users can delete their own account sessions"
  on public.account_sessions for delete to authenticated
  using (auth.uid() = user_id);
grant select, insert, update, delete on public.account_sessions to authenticated;

alter table public.chat_tts_audio_cache
  alter column storage_path drop not null,
  add column if not exists source text not null default 'gemini',
  add column if not exists browser_voice_name text,
  add column if not exists error_details text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_tts_audio_cache'::regclass
      and conname = 'chat_tts_audio_cache_source_check'
  ) then
    alter table public.chat_tts_audio_cache
      add constraint chat_tts_audio_cache_source_check
      check (source in ('gemini', 'browser'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_tts_audio_cache'::regclass
      and conname = 'chat_tts_audio_cache_source_path_check'
  ) then
    alter table public.chat_tts_audio_cache
      add constraint chat_tts_audio_cache_source_path_check
      check (
        (source = 'gemini' and storage_path is not null)
        or (source = 'browser' and storage_path is null)
      );
  end if;
end;
$$;

create index if not exists chat_tts_audio_cache_expiry_idx
  on public.chat_tts_audio_cache (expires_at);

alter table public.chat_tts_audio_cache enable row level security;
revoke all on public.chat_tts_audio_cache from anon, authenticated;

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

create table if not exists public.chat_conversation_branches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  anchor_message_id uuid not null,
  anchor_version_number integer not null check (anchor_version_number >= 1),
  messages jsonb not null check (jsonb_typeof(messages) = 'array'),
  created_at timestamptz not null default now(),
  unique (user_id, anchor_message_id, anchor_version_number),
  foreign key (user_id, anchor_message_id)
    references public.chat_messages (user_id, id)
    on delete cascade
);

alter table public.chat_conversation_branches enable row level security;

drop policy if exists "Users can manage their own conversation branches"
  on public.chat_conversation_branches;
create policy "Users can manage their own conversation branches"
  on public.chat_conversation_branches
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.chat_conversation_branches to authenticated;

create table if not exists public.chat_message_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_id uuid not null,
  assistant_message_id uuid,
  thinking_mode boolean not null default false,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  progress text not null default 'Queued for Cheya',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (user_id, message_id)
    references public.chat_messages (user_id, id)
    on delete cascade,
  foreign key (user_id, assistant_message_id)
    references public.chat_messages (user_id, id)
    on delete cascade
);

alter table public.chat_message_jobs
    add column if not exists progress text not null default 'Queued for Cheya';

create index if not exists chat_message_jobs_user_created_idx
  on public.chat_message_jobs (user_id, created_at desc);

create index if not exists chat_message_jobs_pending_idx
  on public.chat_message_jobs (user_id, status)
  where status in ('queued', 'processing');

alter table public.chat_message_jobs enable row level security;

drop policy if exists "Users can read their own chat message jobs"
  on public.chat_message_jobs;
create policy "Users can read their own chat message jobs"
  on public.chat_message_jobs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own chat message jobs"
  on public.chat_message_jobs;
create policy "Users can create their own chat message jobs"
  on public.chat_message_jobs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

grant select, insert on public.chat_message_jobs to authenticated;

create table if not exists public.chat_message_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_id uuid,
  storage_path text not null,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null check (length(trim(file_name)) between 1 and 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 18874368),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  deleted_at timestamptz,
  unique (user_id, id),
  foreign key (user_id, message_id)
    references public.chat_messages (user_id, id)
    on delete cascade
);

alter table public.chat_message_attachments
  drop constraint if exists chat_message_attachments_storage_path_key;
alter table public.chat_message_attachments
  add column if not exists sha256 text
  check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');

create index if not exists chat_message_attachments_user_message_idx
  on public.chat_message_attachments (user_id, message_id, created_at);
create index if not exists chat_message_attachments_dedupe_idx
  on public.chat_message_attachments (user_id, sha256, expires_at)
  where deleted_at is null and sha256 is not null;

alter table public.chat_message_attachments enable row level security;

drop policy if exists "Users can read their own chat attachments"
  on public.chat_message_attachments;
create policy "Users can read their own chat attachments"
  on public.chat_message_attachments
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.chat_message_attachments to authenticated;
revoke update (deleted_at) on public.chat_message_attachments from authenticated;
revoke delete on public.chat_message_attachments from authenticated;

drop policy if exists "Users can mark their own chat attachments deleted"
  on public.chat_message_attachments;
drop policy if exists "Users can delete their own chat attachments"
  on public.chat_message_attachments;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  18874368,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/x-flv',
    'video/webm', 'video/3gpp', 'video/x-matroska',
    'audio/flac', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav',
    'application/pdf', 'application/json', 'application/xml',
    'text/plain', 'text/csv', 'text/markdown', 'text/html'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-tts-cache', 'chat-tts-cache', false, 20971520, array['audio/wav'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload their own chat attachments" on storage.objects;
create policy "Users can upload their own chat attachments"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can read their unexpired chat attachments" on storage.objects;
create policy "Users can read their unexpired chat attachments"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1
      from public.chat_message_attachments as attachment
      where attachment.user_id = auth.uid()
        and attachment.storage_path = storage.objects.name
        and attachment.expires_at > now()
        and attachment.deleted_at is null
    )
  );

drop policy if exists "Users can delete their own chat attachments" on storage.objects;
create policy "Users can delete their own chat attachments"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.register_chat_attachment_reference(
  p_id uuid,
  p_user_id uuid,
  p_sha256 text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns table (
  id uuid,
  user_id uuid,
  message_id uuid,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz,
  expires_at timestamptz,
  deleted_at timestamptz,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_path text;
  canonical_mime_type text;
  canonical_size bigint;
  did_reuse boolean := false;
begin
  if p_id is null
    or p_user_id is null
    or p_sha256 is null
    or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_size_bytes not between 1 and 18874368
    or p_file_name is null
    or length(trim(p_file_name)) not between 1 and 255
    or p_mime_type is null
    or length(trim(p_mime_type)) = 0 then
    raise exception 'Invalid attachment metadata.';
  end if;

  if p_storage_path is not null
    and p_storage_path <> (p_user_id::text || '/' || p_id::text) then
    raise exception 'Invalid attachment storage path.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_sha256, 0)
  );

  select attachment.storage_path, attachment.mime_type, attachment.size_bytes
  into canonical_path, canonical_mime_type, canonical_size
  from public.chat_message_attachments as attachment
  where attachment.user_id = p_user_id
    and attachment.sha256 = p_sha256
    and attachment.expires_at > now()
    and attachment.deleted_at is null
  order by attachment.created_at desc
  limit 1;

  if canonical_path is not null then
    did_reuse := true;
    if canonical_size <> p_size_bytes then
      raise exception 'Attachment hash matched a file with a different size.';
    end if;
  elsif p_storage_path is not null then
    canonical_path := p_storage_path;
    canonical_mime_type := p_mime_type;
    canonical_size := p_size_bytes;
  else
    return;
  end if;

  return query
  insert into public.chat_message_attachments as attachment (
    id, user_id, storage_path, sha256, file_name, mime_type, size_bytes
  )
  values (
    p_id, p_user_id, canonical_path, p_sha256, trim(p_file_name),
    canonical_mime_type, canonical_size
  )
  returning
    attachment.id,
    attachment.user_id,
    attachment.message_id,
    attachment.storage_path,
    attachment.file_name,
    attachment.mime_type,
    attachment.size_bytes,
    attachment.created_at,
    attachment.expires_at,
    attachment.deleted_at,
    did_reuse;
end;
$$;

create or replace function public.release_chat_attachment_reference(
  p_attachment_id uuid,
  p_user_id uuid,
  p_expired_only boolean default false
)
returns table (storage_path text, should_delete boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_path text;
  target_hash text;
  target_expiry timestamptz;
begin
  select attachment.storage_path, attachment.sha256, attachment.expires_at
  into target_path, target_hash, target_expiry
  from public.chat_message_attachments as attachment
  where attachment.id = p_attachment_id
    and attachment.user_id = p_user_id
  for update;

  if target_path is null or (p_expired_only and target_expiry > now()) then
    return query select null::text, false;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || coalesce(target_hash, target_path), 0)
  );

  update public.chat_message_attachments
  set deleted_at = coalesce(deleted_at, now())
  where id = p_attachment_id
    and user_id = p_user_id;

  if exists (
    select 1
    from public.chat_message_attachments as attachment
    where attachment.user_id = p_user_id
      and attachment.storage_path = target_path
      and attachment.id <> p_attachment_id
      and attachment.expires_at > now()
      and attachment.deleted_at is null
  ) then
    delete from public.chat_message_attachments
    where id = p_attachment_id
      and user_id = p_user_id;
    return query select null::text, false;
    return;
  end if;

  return query select target_path, true;
end;
$$;

create or replace function public.purge_released_chat_attachment_references(
  p_user_id uuid,
  p_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_storage_path, 0)
  );

  if exists (
    select 1
    from public.chat_message_attachments as attachment
    where attachment.user_id = p_user_id
      and attachment.storage_path = p_storage_path
      and attachment.expires_at > now()
      and attachment.deleted_at is null
  ) then
    return false;
  end if;

  delete from public.chat_message_attachments
  where user_id = p_user_id
    and storage_path = p_storage_path;

  return true;
end;
$$;

revoke all on function public.register_chat_attachment_reference(uuid, uuid, text, text, text, text, bigint)
  from public, anon, authenticated;
revoke all on function public.release_chat_attachment_reference(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.purge_released_chat_attachment_references(uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_chat_attachment_reference(uuid, uuid, text, text, text, text, bigint)
  to service_role;
grant execute on function public.release_chat_attachment_reference(uuid, uuid, boolean)
  to service_role;
grant execute on function public.purge_released_chat_attachment_references(uuid, text)
  to service_role;

create or replace function public.record_chat_message_version()
returns trigger
language plpgsql
security invoker
set search_path = public, auth
as $$
begin
  if current_setting('cheyaverse.restore_chat_branch', true) = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.content is distinct from old.content
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
    if target.is_active then
      insert into public.chat_conversation_branches (
        user_id,
        anchor_message_id,
        anchor_version_number,
        messages
      )
      select
        auth.uid(),
        target.id,
        target.version_number,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'message_id', messages.id,
              'version_number', messages.version_number
            )
            order by messages.created_at, messages.id
          ),
          '[]'::jsonb
        )
      from public.chat_messages as messages
      where messages.user_id = auth.uid()
        and messages.is_active
      on conflict (user_id, anchor_message_id, anchor_version_number) do update
        set messages = excluded.messages;
    end if;
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

create or replace function public.restore_chat_branch(
  p_anchor_message_id uuid,
  p_anchor_version_number integer
)
returns setof public.chat_messages
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  branch_snapshot public.chat_conversation_branches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select * into branch_snapshot
  from public.chat_conversation_branches
  where user_id = auth.uid()
    and anchor_message_id = p_anchor_message_id
    and anchor_version_number = p_anchor_version_number;
  if not found then
    if not exists (
      select 1
      from public.chat_message_versions
      where user_id = auth.uid()
        and message_id = p_anchor_message_id
        and version_number = p_anchor_version_number
    ) then
      raise exception 'The requested message version was not found.';
    end if;

    insert into public.chat_conversation_branches (
      user_id,
      anchor_message_id,
      anchor_version_number,
      messages
    )
    select
      auth.uid(),
      p_anchor_message_id,
      p_anchor_version_number,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'message_id', messages.id,
            'version_number',
              case
                when messages.id = p_anchor_message_id then p_anchor_version_number
                else messages.version_number
              end
          )
          order by messages.created_at, messages.id
        ),
        '[]'::jsonb
      )
    from public.chat_messages as messages
    where messages.user_id = auth.uid()
      and (messages.is_active or messages.id = p_anchor_message_id);

    select * into branch_snapshot
    from public.chat_conversation_branches
    where user_id = auth.uid()
      and anchor_message_id = p_anchor_message_id
      and anchor_version_number = p_anchor_version_number;
  end if;

  perform set_config('cheyaverse.restore_chat_branch', 'on', true);
  update public.chat_messages
  set is_active = false
  where user_id = auth.uid()
    and is_active;

  update public.chat_messages as messages
  set content = versions.content,
      embedding = versions.embedding,
      thinking_summary = versions.thinking_summary,
      version_number = versions.version_number,
      revision_reason = versions.revision_reason,
      is_active = true
  from jsonb_to_recordset(branch_snapshot.messages) as snapshot(
    message_id uuid,
    version_number integer
  )
  join public.chat_message_versions as versions
    on versions.message_id = snapshot.message_id
    and versions.version_number = snapshot.version_number
    and versions.user_id = auth.uid()
  where messages.id = snapshot.message_id
    and messages.user_id = auth.uid();

  return query
  select *
  from public.chat_messages
  where user_id = auth.uid()
    and is_active
  order by created_at, id;
end;
$$;

create or replace function public.save_chat_branch(
  p_anchor_message_id uuid,
  p_anchor_version_number integer
)
returns void
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  anchor_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select exists (
    select 1
    from public.chat_messages
    where id = p_anchor_message_id
      and user_id = auth.uid()
      and version_number = p_anchor_version_number
      and is_active
  ) into anchor_exists;
  if not anchor_exists then
    raise exception 'The active message version was not found.';
  end if;

  insert into public.chat_conversation_branches (
    user_id,
    anchor_message_id,
    anchor_version_number,
    messages
  )
  select
    auth.uid(),
    p_anchor_message_id,
    p_anchor_version_number,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'message_id', messages.id,
          'version_number', messages.version_number
        )
        order by messages.created_at, messages.id
      ),
      '[]'::jsonb
    )
  from public.chat_messages as messages
  where messages.user_id = auth.uid()
    and messages.is_active
  on conflict (user_id, anchor_message_id, anchor_version_number) do update
    set messages = excluded.messages;
end;
$$;

create or replace function public.create_chat_job(
  p_content text,
  p_thinking_mode boolean default false
)
returns table (job_id uuid, message_id uuid)
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  new_message_id uuid;
  new_job_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to send a chat message.';
  end if;
  if length(trim(p_content)) = 0 or length(p_content) > 50000 then
    raise exception 'Message content must be between 1 and 50000 characters.';
  end if;

  insert into public.chat_messages (user_id, role, content)
  values (auth.uid(), 'user', p_content)
  returning id into new_message_id;

  insert into public.chat_message_jobs (user_id, message_id, thinking_mode)
  values (auth.uid(), new_message_id, coalesce(p_thinking_mode, false))
  returning id into new_job_id;

  return query select new_job_id, new_message_id;
end;
$$;

create or replace function public.create_chat_job_with_attachments(
  p_content text,
  p_thinking_mode boolean default false,
  p_attachment_ids uuid[] default '{}'
)
returns table (job_id uuid, message_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_message_id uuid;
  new_job_id uuid;
  attachment_count integer := coalesce(cardinality(p_attachment_ids), 0);
  owned_attachment_count integer;
  attachment_bytes bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to send a chat message.';
  end if;
  if length(trim(coalesce(p_content, ''))) = 0 or length(p_content) > 50000 then
    raise exception 'Message content must be between 1 and 50000 characters.';
  end if;
  if attachment_count > 10 then
    raise exception 'A message can include at most 10 attachments.';
  end if;
  if attachment_count <> (
    select count(distinct attachment_id)
    from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as requested(attachment_id)
  ) then
    raise exception 'Attachment IDs must be unique.';
  end if;

  select count(*), coalesce(sum(attachment.size_bytes), 0)
  into owned_attachment_count, attachment_bytes
  from public.chat_message_attachments as attachment
  where attachment.id = any(coalesce(p_attachment_ids, '{}'::uuid[]))
    and attachment.user_id = auth.uid()
    and attachment.message_id is null
    and attachment.expires_at > now()
    and attachment.deleted_at is null;

  if owned_attachment_count <> attachment_count then
    raise exception 'One or more attachments are missing, expired, or already used.';
  end if;
  if attachment_bytes > 52428800 then
    raise exception 'Attachments for one message cannot exceed 50 MB in total.';
  end if;

  insert into public.chat_messages (user_id, role, content)
  values (auth.uid(), 'user', p_content)
  returning id into new_message_id;

  insert into public.chat_message_jobs (user_id, message_id, thinking_mode)
  values (auth.uid(), new_message_id, coalesce(p_thinking_mode, false))
  returning id into new_job_id;

  update public.chat_message_attachments
  set message_id = new_message_id
  where id = any(coalesce(p_attachment_ids, '{}'::uuid[]))
    and user_id = auth.uid();

  return query select new_job_id, new_message_id;
end;
$$;

create or replace function public.complete_chat_job(
  p_job_id uuid,
  p_content text,
  p_embedding extensions.vector(768),
  p_thinking_summary text
)
returns setof public.chat_messages
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  job public.chat_message_jobs%rowtype;
  result public.chat_messages%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the chat workflow can complete a message job.';
  end if;
  if length(trim(p_content)) = 0 or length(p_content) > 50000 then
    raise exception 'Assistant response must be between 1 and 50000 characters.';
  end if;

  select * into job
  from public.chat_message_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception 'Chat job not found.';
  end if;

  if job.status = 'completed' and job.assistant_message_id is not null then
    return query
    select *
    from public.chat_messages
    where id = job.assistant_message_id
      and user_id = job.user_id;
    return;
  end if;

  insert into public.chat_messages (
    user_id,
    role,
    content,
    embedding,
    thinking_summary,
    revision_reason
  )
  values (
    job.user_id,
    'assistant',
    p_content,
    p_embedding,
    p_thinking_summary,
    'initial'
  )
  returning * into result;

  update public.chat_message_jobs
  set assistant_message_id = result.id,
      status = 'completed',
      error = null,
      updated_at = now(),
      completed_at = now()
  where id = p_job_id;

  return next result;
end;
$$;

create or replace function public.match_chat_messages_for_user(
  p_user_id uuid,
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
language plpgsql
stable
security definer
set search_path = public, extensions, auth
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'This retrieval function is reserved for the chat workflow.';
  end if;

  return query
  select
    messages.id,
    messages.role,
    messages.content,
    messages.created_at,
    1 - (messages.embedding <=> query_embedding) as similarity
  from public.chat_messages as messages
  where messages.user_id = p_user_id
    and messages.is_active
    and messages.embedding is not null
    and messages.id is distinct from exclude_message_id
  order by messages.embedding <=> query_embedding
  limit least(greatest(result_limit, 1), 20);
end;
$$;

create or replace function public.match_chat_messages_before_for_user(
  p_user_id uuid,
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
language plpgsql
stable
security definer
set search_path = public, extensions, auth
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'This retrieval function is reserved for the chat workflow.';
  end if;

  return query
  select
    messages.id,
    messages.role,
    messages.content,
    messages.created_at,
    1 - (messages.embedding <=> query_embedding) as similarity
  from public.chat_messages as messages
  where messages.user_id = p_user_id
    and messages.is_active
    and messages.embedding is not null
    and messages.created_at < max_created_at
    and messages.id is distinct from exclude_message_id
  order by messages.embedding <=> query_embedding
  limit least(greatest(result_limit, 1), 20);
end;
$$;

create or replace function public.match_user_memories_for_user(
  p_user_id uuid,
  query_embedding extensions.vector(768),
  result_limit integer default 6
)
returns table (
  id uuid,
  category text,
  content text,
  similarity double precision
)
language plpgsql
stable
security definer
set search_path = public, extensions, auth
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'This retrieval function is reserved for the chat workflow.';
  end if;

  return query
  select
    memories.id,
    memories.category,
    memories.content,
    1 - (memories.embedding <=> query_embedding) as similarity
  from public.user_memories as memories
  where memories.user_id = p_user_id
    and memories.embedding is not null
  order by memories.embedding <=> query_embedding
  limit least(greatest(result_limit, 1), 20);
end;
$$;

revoke all on function public.create_chat_job(text, boolean) from public, anon;
grant execute on function public.create_chat_job(text, boolean) to authenticated;
revoke all on function public.create_chat_job_with_attachments(text, boolean, uuid[])
  from public, anon;
grant execute on function public.create_chat_job_with_attachments(text, boolean, uuid[])
  to authenticated;
revoke all on function public.complete_chat_job(uuid, text, extensions.vector, text)
  from public, anon, authenticated;
grant execute on function public.complete_chat_job(uuid, text, extensions.vector, text)
  to service_role;
revoke all on function public.match_chat_messages_for_user(uuid, extensions.vector, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.match_chat_messages_for_user(uuid, extensions.vector, integer, uuid)
  to service_role;
revoke all on function public.match_chat_messages_before_for_user(uuid, extensions.vector, timestamptz, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.match_chat_messages_before_for_user(uuid, extensions.vector, timestamptz, integer, uuid)
  to service_role;
revoke all on function public.match_user_memories_for_user(uuid, extensions.vector, integer)
  from public, anon, authenticated;
grant execute on function public.match_user_memories_for_user(uuid, extensions.vector, integer)
  to service_role;

revoke all on function public.restore_chat_branch(uuid, integer) from public, anon;
grant execute on function public.restore_chat_branch(uuid, integer) to authenticated;
revoke all on function public.save_chat_branch(uuid, integer) from public, anon;
grant execute on function public.save_chat_branch(uuid, integer) to authenticated;

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
  source_message_id uuid,
  category text not null default 'general',
  content text not null check (length(trim(content)) > 0 and length(content) <= 10000),
  embedding extensions.vector(768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_memories_source_message_fk foreign key (user_id, source_message_id)
    references public.chat_messages (user_id, id)
    on delete cascade
);

alter table public.user_memories
  add column if not exists source_message_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_memories'::regclass
      and conname = 'user_memories_source_message_fk'
  ) then
    alter table public.user_memories
      add constraint user_memories_source_message_fk
      foreign key (user_id, source_message_id)
      references public.chat_messages (user_id, id)
      on delete cascade;
  end if;
end;
$$;

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
    user_id, supabase_url, publishable_key, display_name, custom_prompt, chat_style,
    tts_api_key, tts_api_keys, tts_voice, updated_at
  )
  select
    auth.uid(), '', '',
    coalesce(incoming.display_name, ''), coalesce(incoming.custom_prompt, ''),
    coalesce(incoming.chat_style, ''), coalesce(incoming.tts_api_key, ''),
    coalesce(
      incoming.tts_api_keys,
      case
        when length(trim(coalesce(incoming.tts_api_key, ''))) > 0
          then jsonb_build_array(incoming.tts_api_key)
        else '[]'::jsonb
      end
    ),
    coalesce(incoming.tts_voice, 'Kore'), coalesce(incoming.updated_at, now())
  from jsonb_to_record(p_data -> 'user_settings') as incoming(
    supabase_url text,
    publishable_key text,
    display_name text,
    custom_prompt text,
    chat_style text,
    tts_api_key text,
    tts_api_keys jsonb,
    tts_voice text,
    updated_at timestamptz
  )
  where jsonb_typeof(p_data -> 'user_settings') = 'object'
  on conflict (user_id) do update
    set supabase_url = excluded.supabase_url,
        publishable_key = excluded.publishable_key,
        display_name = excluded.display_name,
        custom_prompt = excluded.custom_prompt,
        chat_style = excluded.chat_style,
        tts_api_key = case
          when (p_data -> 'user_settings') ? 'tts_api_key' then excluded.tts_api_key
          else public.user_settings.tts_api_key
        end,
        tts_api_keys = case
          when (p_data -> 'user_settings') ? 'tts_api_keys' then excluded.tts_api_keys
          when (p_data -> 'user_settings') ? 'tts_api_key'
            and length(trim(coalesce(excluded.tts_api_key, ''))) > 0
            then jsonb_build_array(excluded.tts_api_key)
          else public.user_settings.tts_api_keys
        end,
        tts_voice = case
          when (p_data -> 'user_settings') ? 'tts_voice' then excluded.tts_voice
          else public.user_settings.tts_voice
        end,
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
    id, user_id, source_message_id, category, content, embedding, created_at, updated_at
  )
  select
    id, auth.uid(), source_message_id, category, content, embedding, created_at, updated_at
  from jsonb_to_recordset(coalesce(p_data -> 'user_memories', '[]'::jsonb)) as incoming(
    id uuid, source_message_id uuid, category text, content text,
    embedding extensions.vector(768), created_at timestamptz, updated_at timestamptz
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

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'chat_messages',
      'chat_message_versions',
      'chat_conversation_branches',
      'chat_message_jobs',
      'chat_message_attachments',
      'account_sessions',
      'message_feedback',
      'message_insights',
      'user_memories',
      'user_settings',
      'ai_api_keys'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          table_name
        );
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.delete_chat_branch_from_message(p_message_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  anchor_message public.chat_messages%rowtype;
  removed_message_ids uuid[];
  removed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select * into anchor_message
  from public.chat_messages
  where id = p_message_id
    and user_id = auth.uid()
    and role = 'user'
  for update;
  if not found then
    raise exception 'The user message to delete was not found.';
  end if;

  select array_agg(id)
  into removed_message_ids
  from public.chat_messages
  where user_id = auth.uid()
    and (created_at, id) >= (anchor_message.created_at, anchor_message.id);

  delete from public.chat_conversation_branches as branch
  where branch.user_id = auth.uid()
    and (
      branch.anchor_message_id = any(removed_message_ids)
      or exists (
        select 1
        from jsonb_array_elements(branch.messages) as branch_message
        where (branch_message ->> 'message_id')::uuid = any(removed_message_ids)
      )
    );

  delete from public.chat_messages
  where user_id = auth.uid()
    and id = any(removed_message_ids);
  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;

revoke all on function public.delete_chat_branch_from_message(uuid) from public, anon;
grant execute on function public.delete_chat_branch_from_message(uuid) to authenticated;

create table if not exists public.database_activity_state (
  singleton boolean primary key default true check (singleton),
  last_activity_at timestamptz not null default now(),
  last_keepalive_at timestamptz
);

insert into public.database_activity_state (singleton, last_activity_at)
values (true, now())
on conflict (singleton) do nothing;

revoke all on public.database_activity_state from public, anon, authenticated;

create table if not exists public.database_keepalive_pulses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

revoke all on public.database_keepalive_pulses from public, anon, authenticated;

create or replace function public.track_database_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.database_activity_state
  set last_activity_at = now()
  where singleton;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'user_settings',
    'ai_api_keys',
    'chat_messages',
    'chat_message_versions',
    'chat_conversation_branches',
    'chat_message_jobs',
    'message_insights',
    'user_memories',
    'message_feedback'
  ]
  loop
    execute format(
      'drop trigger if exists track_database_activity on public.%I',
      table_name
    );
    execute format(
      'create trigger track_database_activity after insert or update or delete on public.%I for each row execute function public.track_database_activity()',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.run_database_keepalive()
returns table (
  pinged boolean,
  idle_days numeric,
  last_activity_at timestamptz,
  last_keepalive_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  activity_state public.database_activity_state%rowtype;
  pulse_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the scheduled server task can run database keepalive.';
  end if;

  select * into activity_state
  from public.database_activity_state
  where singleton
  for update;

  if not found then
    raise exception 'Database activity tracking is not initialized.';
  end if;

  if activity_state.last_activity_at <= now() - interval '5 days'
    and (
      activity_state.last_keepalive_at is null
      or activity_state.last_keepalive_at <= now() - interval '5 days'
    ) then
    insert into public.database_keepalive_pulses default values
    returning id into pulse_id;

    delete from public.database_keepalive_pulses
    where id = pulse_id;

    update public.database_activity_state
    set last_keepalive_at = now()
    where singleton
    returning * into activity_state;

    return query
    select
      true,
      round(extract(epoch from (now() - activity_state.last_activity_at)) / 86400, 2),
      activity_state.last_activity_at,
      activity_state.last_keepalive_at;
  else
    return query
    select
      false,
      round(extract(epoch from (now() - activity_state.last_activity_at)) / 86400, 2),
      activity_state.last_activity_at,
      activity_state.last_keepalive_at;
  end if;
end;
$$;

revoke all on function public.run_database_keepalive() from public, anon, authenticated;
grant execute on function public.run_database_keepalive() to service_role;
