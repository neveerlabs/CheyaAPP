create extension if not exists pg_trgm;
create extension if not exists vector with schema extensions;

create index if not exists chat_messages_content_trgm
  on public.chat_messages using gin (content gin_trgm_ops);

create index if not exists user_memories_content_trgm
  on public.user_memories using gin (content gin_trgm_ops);

create index if not exists message_insights_summary_trgm
  on public.message_insights using gin (summary gin_trgm_ops);

create index if not exists chat_messages_user_created
  on public.chat_messages (user_id, created_at desc)
  where is_active;

create index if not exists message_feedback_message_version
  on public.message_feedback (message_id, version_number);

create table if not exists public.user_insights (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,
  embedding vector(768),
  updated_at timestamptz not null default now()
);

alter table public.message_feedback
  add column if not exists retrieval_snapshot jsonb default '{}'::jsonb,
  add column if not exists weight_delta numeric default 0;

do $$
begin
  if not exists (
    select 1
    from pg_type as t
    join pg_namespace as n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'feedback_kind'
  ) then
    create type public.feedback_kind as enum ('like', 'dislike', 'report', 'warning');
  end if;
end;
$$;

create table if not exists public.rag_chunks (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  user_id uuid references auth.users(id) on delete cascade,
  content text not null,
  embedding vector(768),
  weight numeric not null default 1.0,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists rag_chunks_embedding_idx
  on public.rag_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.message_insights
  add column if not exists expires_at timestamptz;

create or replace view public.message_feedback_legacy as
select
  id,
  user_id,
  message_id,
  version_number,
  case when kind = 'warning' then 'report' else kind end as kind,
  details,
  retrieval_snapshot,
  weight_delta,
  created_at
from public.message_feedback;

create table if not exists public.blocked_retrieval_patterns (
  user_id uuid not null references auth.users(id) on delete cascade,
  pattern_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, pattern_hash)
);
