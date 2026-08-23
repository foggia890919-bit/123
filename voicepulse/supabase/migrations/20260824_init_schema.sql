-- ============================================================================
-- VoicePulse 초기 스키마
-- 적용: supabase db push  (또는 supabase migration up)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────

create type public.session_type as enum ('CALL', 'MEETING', 'NOTE');
create type public.session_status as enum ('UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- ── Tables ──────────────────────────────────────────────────────────────────

create table public.audio_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  session_type     public.session_type not null default 'NOTE',
  title            text not null default '',
  -- Storage 오브젝트 경로({user_id}/{session_id}.{ext}) — 서명 URL이 아님
  audio_url        text,
  duration_seconds numeric,
  status           public.session_status not null default 'UPLOADING',
  error_message    text,
  created_at       timestamptz not null default now()
);

create index audio_sessions_user_created_idx
  on public.audio_sessions (user_id, created_at desc);

create table public.transcript_segments (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.audio_sessions (id) on delete cascade,
  speaker_label text not null,
  start_time    numeric not null,
  end_time      numeric not null,
  text          text not null
);

create index transcript_segments_session_start_idx
  on public.transcript_segments (session_id, start_time);

create table public.ai_insights (
  id           uuid primary key default gen_random_uuid(),
  -- 세션당 1행: UNIQUE 제약으로 Edge Function의 upsert(on conflict) 대상이 된다
  session_id   uuid not null unique references public.audio_sessions (id) on delete cascade,
  summary      jsonb,
  decisions    jsonb,
  action_items jsonb,
  mindmap_data jsonb,
  raw_response jsonb,
  created_at   timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.audio_sessions     enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.ai_insights        enable row level security;

-- audio_sessions: 본인 행만 CRUD
create policy "audio_sessions_select_own" on public.audio_sessions
  for select using (auth.uid() = user_id);

create policy "audio_sessions_insert_own" on public.audio_sessions
  for insert with check (auth.uid() = user_id);

create policy "audio_sessions_update_own" on public.audio_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "audio_sessions_delete_own" on public.audio_sessions
  for delete using (auth.uid() = user_id);

-- 컬럼 제한(RLS는 컬럼 단위 제어가 불가하므로 GRANT로 보완):
-- 클라이언트(authenticated)는 title / audio_url / duration_seconds 만 갱신할 수 있고,
-- status / error_message / session_type 은 Edge Function(service_role)만 변경한다.
revoke update on public.audio_sessions from authenticated;
grant update (title, audio_url, duration_seconds) on public.audio_sessions to authenticated;

-- 알려진 MVP 한계: audio_sessions 행 삭제 시 storage.objects 의 오디오 파일은
-- FK 캐스케이드 대상이 아니므로 남는다. 삭제 UI 도입 시 스토리지 정리 로직 필요.

-- transcript_segments: 부모 세션 소유자만 조회. 쓰기는 service_role 전용.
create policy "transcript_segments_select_own" on public.transcript_segments
  for select using (
    exists (
      select 1 from public.audio_sessions s
      where s.id = transcript_segments.session_id and s.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.transcript_segments from authenticated;

-- ai_insights: 소유자 조회 + action_items 완료 토글을 위한 갱신.
-- WITH CHECK 를 명시해 갱신 후 행도 반드시 본인 세션에 속하도록 강제한다.
create policy "ai_insights_select_own" on public.ai_insights
  for select using (
    exists (
      select 1 from public.audio_sessions s
      where s.id = ai_insights.session_id and s.user_id = auth.uid()
    )
  );

create policy "ai_insights_update_own" on public.ai_insights
  for update
  using (
    exists (
      select 1 from public.audio_sessions s
      where s.id = ai_insights.session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.audio_sessions s
      where s.id = ai_insights.session_id and s.user_id = auth.uid()
    )
  );

-- 클라이언트는 action_items 컬럼만 갱신 가능. insert/delete 는 service_role 전용.
revoke insert, update, delete on public.ai_insights from authenticated;
grant update (action_items) on public.ai_insights to authenticated;

-- ── Storage: private 버킷 audio-recordings ──────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio-recordings',
  'audio-recordings',
  false,
  104857600, -- 100MB
  array[
    'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
    'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/webm'
  ]
)
on conflict (id) do nothing;

-- 경로 규약 {user_id}/{session_id}.{ext} 의 최상위 폴더가 본인 uid 인 오브젝트만 허용
create policy "audio_objects_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "audio_objects_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "audio_objects_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "audio_objects_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
