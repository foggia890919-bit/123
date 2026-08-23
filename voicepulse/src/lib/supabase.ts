import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import type { Database, SessionType } from '../types/database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았습니다. .env를 확인하세요.',
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const AUDIO_BUCKET = 'audio-recordings';

const MIME_BY_EXT: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

/**
 * RN에서 신뢰 가능한 업로드 경로: base64로 읽어 ArrayBuffer로 변환 후 업로드.
 * (RN 환경의 Blob/FormData는 supabase-js와 호환이 불안정)
 * 메모리에 파일 전체를 올리므로 대용량(수십 MB↑) 파일은 한계가 있음 — MVP 허용.
 */
export async function uploadAudio(
  userId: string,
  sessionId: string,
  localUri: string,
  ext: string,
): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const path = `${userId}/${sessionId}.${ext}`;
  const { error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(path, decode(base64), {
      contentType: MIME_BY_EXT[ext] ?? 'audio/mp4',
      upsert: true,
    });
  if (error) throw error;
  return path;
}

/** 재생용 서명 URL (private 버킷) */
export async function getSignedAudioUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    throw error ?? new Error('서명 URL 생성 실패');
  }
  return data.signedUrl;
}

export interface CreateSessionOptions {
  localUri: string;
  ext: string;
  title: string;
  sessionType: SessionType;
  durationSeconds: number | null;
}

/**
 * 세션 행 생성(UPLOADING) → 스토리지 업로드 → audio_url 갱신.
 * status 전환(PROCESSING/COMPLETED/FAILED)은 Edge Function(service_role) 전용.
 * 반환: 생성된 session id
 */
export async function createSessionWithUpload(
  opts: CreateSessionOptions,
): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error('로그인이 필요합니다');
  }
  const userId = userData.user.id;

  const { data: session, error: insertError } = await supabase
    .from('audio_sessions')
    .insert({
      user_id: userId,
      session_type: opts.sessionType,
      title: opts.title,
      duration_seconds: opts.durationSeconds,
      status: 'UPLOADING',
    })
    .select('id')
    .single();
  if (insertError || !session) {
    throw insertError ?? new Error('세션 생성에 실패했습니다');
  }

  const path = await uploadAudio(userId, session.id, opts.localUri, opts.ext);

  const { error: updateError } = await supabase
    .from('audio_sessions')
    .update({ audio_url: path })
    .eq('id', session.id);
  if (updateError) throw updateError;

  return session.id;
}
