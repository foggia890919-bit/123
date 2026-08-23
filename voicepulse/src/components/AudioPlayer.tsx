import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useAudioStore } from '../stores/useAudioStore';
import { formatTimestamp } from '../utils/formatters';

interface AudioPlayerProps {
  uri: string;
  sessionId: string;
}

/**
 * 타임스탬프 싱크 오디오 플레이어.
 * - TranscriptViewer가 store의 seekRequestMs를 쓰면 여기서 소비해 시크+재생
 * - 재생 위치는 ~250ms 간격으로 store에 반영되어 활성 세그먼트 하이라이트에 사용
 */
export default function AudioPlayer({ uri, sessionId }: AudioPlayerProps) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [loaded, setLoaded] = useState(false);

  const positionMs = useAudioStore((s) => s.positionMs);
  const durationMs = useAudioStore((s) => s.durationMs);
  const isPlaying = useAudioStore((s) => s.isPlaying);
  const seekRequestMs = useAudioStore((s) => s.seekRequestMs);
  const setPlaybackSession = useAudioStore((s) => s.setPlaybackSession);
  const clearSeekRequest = useAudioStore((s) => s.clearSeekRequest);
  const updatePlaybackStatus = useAudioStore((s) => s.updatePlaybackStatus);
  const resetPlayback = useAudioStore((s) => s.resetPlayback);

  useEffect(() => {
    let cancelled = false;

    const onStatus = (status: AVPlaybackStatus) => {
      if (!status.isLoaded) return;
      updatePlaybackStatus({
        positionMs: status.positionMillis,
        durationMs: status.durationMillis ?? 0,
        isPlaying: status.isPlaying,
      });
    };

    (async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { progressUpdateIntervalMillis: 250 },
          onStatus,
        );
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        setPlaybackSession(sessionId);
        setLoaded(true);
      } catch (err) {
        console.warn('[AudioPlayer] 로드 실패:', err);
      }
    })();

    return () => {
      cancelled = true;
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) sound.unloadAsync().catch(() => undefined);
      resetPlayback();
    };
  }, [uri, sessionId, setPlaybackSession, updatePlaybackStatus, resetPlayback]);

  // 스크립트 탭에서 온 시크 요청 소비
  useEffect(() => {
    if (seekRequestMs == null) return;
    const sound = soundRef.current;
    clearSeekRequest();
    if (!sound) return;
    (async () => {
      try {
        await sound.setPositionAsync(seekRequestMs);
        await sound.playAsync();
      } catch (err) {
        console.warn('[AudioPlayer] 시크 실패:', err);
      }
    })();
  }, [seekRequestMs, clearSeekRequest]);

  const togglePlay = async () => {
    const sound = soundRef.current;
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
    } else {
      // 끝까지 재생한 뒤에는 처음부터
      if (durationMs > 0 && positionMs >= durationMs - 100) {
        await sound.setPositionAsync(0);
      }
      await sound.playAsync();
    }
  };

  const skip = async (deltaMs: number) => {
    const sound = soundRef.current;
    if (!sound) return;
    const next = Math.max(0, Math.min(durationMs, positionMs + deltaMs));
    await sound.setPositionAsync(next);
  };

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <View className="rounded-2xl border border-border bg-card px-4 py-3">
      <View className="flex-row items-center justify-center">
        <Pressable
          className="mr-6 p-2 active:opacity-70"
          onPress={() => skip(-10_000)}
          disabled={!loaded}
        >
          <Ionicons name="play-back-outline" size={22} color="#8B94A7" />
        </Pressable>
        <Pressable
          className="h-12 w-12 items-center justify-center rounded-full bg-primary active:opacity-80"
          onPress={togglePlay}
          disabled={!loaded}
        >
          {loaded ? (
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="#fff" />
          ) : (
            <ActivityIndicator color="#fff" size="small" />
          )}
        </Pressable>
        <Pressable
          className="ml-6 p-2 active:opacity-70"
          onPress={() => skip(10_000)}
          disabled={!loaded}
        >
          <Ionicons name="play-forward-outline" size={22} color="#8B94A7" />
        </Pressable>
      </View>

      <View className="mt-3">
        <View className="h-1.5 overflow-hidden rounded-full bg-border">
          <View
            className="h-full rounded-full bg-primary"
            style={{ width: `${progress * 100}%` }}
          />
        </View>
        <View className="mt-1 flex-row justify-between">
          <Text className="text-xs tabular-nums text-muted">
            {formatTimestamp(positionMs / 1000)}
          </Text>
          <Text className="text-xs tabular-nums text-muted">
            {formatTimestamp(durationMs / 1000)}
          </Text>
        </View>
      </View>
    </View>
  );
}
