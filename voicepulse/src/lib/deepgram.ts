// Deepgram API 키는 절대 앱 번들에 넣지 않는다 — STT 호출은 전부
// Supabase Edge Function(process-audio)에서 서버 사이드로 수행된다.
// 이 모듈은 파이프라인 호출 래퍼와 Deepgram 형태의 공유 타입만 제공한다.

import { supabase } from './supabase';

export interface DeepgramUtteranceShape {
  start: number;
  end: number;
  transcript: string;
  speaker?: number;
}

export interface ProcessAudioResponse {
  success?: boolean;
  session_id?: string;
  segments_count?: number;
  insight_id?: string | null;
  error?: string;
}

/**
 * process-audio Edge Function 호출 (Deepgram STT + Claude 구조화 파이프라인).
 * 처리에 수십 초~수 분이 걸리므로 화면에서는 보통 await 없이 fire-and-forget으로
 * 호출하고, 세션 status 폴링으로 완료를 감지한다.
 */
export async function invokeProcessAudio(
  sessionId: string,
): Promise<ProcessAudioResponse> {
  const { data, error } = await supabase.functions.invoke<ProcessAudioResponse>(
    'process-audio',
    { body: { session_id: sessionId } },
  );
  if (error) throw error;
  return data ?? {};
}

/** 화면 이탈과 무관하게 백그라운드로 처리 시작 (오류는 로그만 남김) */
export function startProcessing(sessionId: string): void {
  invokeProcessAudio(sessionId).catch((err) => {
    console.warn('[process-audio] 백그라운드 호출 실패:', err);
  });
}
