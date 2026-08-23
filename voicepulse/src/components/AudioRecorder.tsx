import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioStore } from '../stores/useAudioStore';
import { formatDuration } from '../utils/formatters';

interface AudioRecorderProps {
  isRecording: boolean;
  isPaused: boolean;
  uploading: boolean;
  onStart: () => void;
  onPauseToggle: () => void;
  onStop: () => void;
}

const MIN_BAR_HEIGHT = 4;
const MAX_BAR_HEIGHT = 72;

/** 실시간 볼륨 미터링 파형 + 경과 시간 + 녹음 컨트롤 */
export default function AudioRecorder({
  isRecording,
  isPaused,
  uploading,
  onStart,
  onPauseToggle,
  onStop,
}: AudioRecorderProps) {
  const elapsedMs = useAudioStore((s) => s.elapsedMs);
  const metering = useAudioStore((s) => s.metering);

  return (
    <View className="flex-1 items-center justify-center px-6">
      {/* 파형 시각화 */}
      <View
        className="w-full flex-row items-center justify-center rounded-2xl bg-surface px-4"
        style={{ height: 120 }}
      >
        {metering.map((level, idx) => (
          <View
            key={idx}
            className={`mx-0.5 rounded-full ${
              isRecording && !isPaused ? 'bg-primary' : 'bg-border'
            }`}
            style={{
              width: 4,
              height: MIN_BAR_HEIGHT + level * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT),
            }}
          />
        ))}
      </View>

      {/* 경과 시간 */}
      <View className="mt-8 flex-row items-center">
        {isRecording && !isPaused && (
          <View className="mr-2 h-3 w-3 rounded-full bg-danger" />
        )}
        <Text className="text-5xl font-bold tabular-nums text-white">
          {formatDuration(Math.floor(elapsedMs / 1000))}
        </Text>
      </View>
      {isPaused && (
        <Text className="mt-2 text-sm text-warning">일시정지됨</Text>
      )}
      {uploading && (
        <Text className="mt-2 text-sm text-accent">업로드하고 있어요…</Text>
      )}

      {/* 컨트롤 */}
      <View className="mt-12 flex-row items-center">
        {isRecording ? (
          <>
            <Pressable
              className="mr-8 h-16 w-16 items-center justify-center rounded-full bg-surface active:opacity-70"
              onPress={onPauseToggle}
              disabled={uploading}
            >
              <Ionicons
                name={isPaused ? 'play' : 'pause'}
                size={26}
                color="#F5A623"
              />
            </Pressable>
            <Pressable
              className="h-20 w-20 items-center justify-center rounded-full bg-danger active:opacity-80"
              onPress={onStop}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons name="stop" size={32} color="#fff" />
              )}
            </Pressable>
          </>
        ) : (
          <Pressable
            className="h-20 w-20 items-center justify-center rounded-full bg-primary active:opacity-80"
            onPress={onStart}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Ionicons name="mic" size={32} color="#fff" />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}
