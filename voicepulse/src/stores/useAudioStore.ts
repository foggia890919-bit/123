import { create } from 'zustand';

export const METERING_BAR_COUNT = 40;
const METERING_FLOOR_DB = -60;

interface RecordingStatusInput {
  isRecording: boolean;
  durationMillis: number;
  metering?: number; // dBFS (-160 ~ 0)
}

interface PlaybackStatusInput {
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
}

interface AudioStore {
  // ── 녹음 상태 ──
  isRecording: boolean;
  isPaused: boolean;
  elapsedMs: number;
  /** 최근 N개의 0~1 정규화 볼륨 (파형 시각화용 링버퍼) */
  metering: number[];
  beginRecording: () => void;
  setPaused: (paused: boolean) => void;
  updateRecordingStatus: (status: RecordingStatusInput) => void;
  resetRecording: () => void;

  // ── 재생 상태 (스크립트 ↔ 플레이어 브리지) ──
  playbackSessionId: string | null;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  /** TranscriptViewer가 쓰고 AudioPlayer가 소비하는 1회성 시크 요청 */
  seekRequestMs: number | null;
  setPlaybackSession: (sessionId: string | null) => void;
  requestSeek: (ms: number) => void;
  clearSeekRequest: () => void;
  updatePlaybackStatus: (status: PlaybackStatusInput) => void;
  resetPlayback: () => void;
}

function normalizeMetering(db: number | undefined): number {
  if (db == null || !isFinite(db)) return 0;
  const clamped = Math.max(METERING_FLOOR_DB, Math.min(0, db));
  return (clamped - METERING_FLOOR_DB) / -METERING_FLOOR_DB;
}

export const useAudioStore = create<AudioStore>()((set) => ({
  isRecording: false,
  isPaused: false,
  elapsedMs: 0,
  metering: Array(METERING_BAR_COUNT).fill(0),

  beginRecording: () =>
    set({
      isRecording: true,
      isPaused: false,
      elapsedMs: 0,
      metering: Array(METERING_BAR_COUNT).fill(0),
    }),

  setPaused: (paused) => set({ isPaused: paused }),

  updateRecordingStatus: (status) =>
    set((state) => ({
      elapsedMs: status.durationMillis,
      metering: state.isPaused
        ? state.metering
        : [...state.metering.slice(1), normalizeMetering(status.metering)],
    })),

  resetRecording: () =>
    set({
      isRecording: false,
      isPaused: false,
      elapsedMs: 0,
      metering: Array(METERING_BAR_COUNT).fill(0),
    }),

  playbackSessionId: null,
  positionMs: 0,
  durationMs: 0,
  isPlaying: false,
  seekRequestMs: null,

  setPlaybackSession: (sessionId) =>
    set({
      playbackSessionId: sessionId,
      positionMs: 0,
      durationMs: 0,
      isPlaying: false,
      seekRequestMs: null,
    }),

  requestSeek: (ms) => set({ seekRequestMs: Math.max(0, ms) }),

  clearSeekRequest: () => set({ seekRequestMs: null }),

  updatePlaybackStatus: (status) =>
    set({
      positionMs: status.positionMs,
      durationMs: status.durationMs,
      isPlaying: status.isPlaying,
    }),

  resetPlayback: () =>
    set({
      playbackSessionId: null,
      positionMs: 0,
      durationMs: 0,
      isPlaying: false,
      seekRequestMs: null,
    }),
}));
