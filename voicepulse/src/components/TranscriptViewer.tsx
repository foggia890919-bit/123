import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAudioStore } from '../stores/useAudioStore';
import type { TranscriptSegment } from '../types/database.types';
import { formatTimestamp } from '../utils/formatters';

interface TranscriptViewerProps {
  segments: TranscriptSegment[];
}

// 화자 인덱스별 버블 색상 팔레트
const SPEAKER_COLORS = [
  { bubble: 'bg-primary/15 border-primary/40', name: 'text-primary' },
  { bubble: 'bg-accent/15 border-accent/40', name: 'text-accent' },
  { bubble: 'bg-warning/15 border-warning/40', name: 'text-warning' },
  { bubble: 'bg-danger/15 border-danger/40', name: 'text-danger' },
];

function speakerIndex(label: string): number {
  const match = /(\d+)/.exec(label);
  const n = match ? parseInt(match[1], 10) - 1 : 0;
  return ((n % SPEAKER_COLORS.length) + SPEAKER_COLORS.length) %
    SPEAKER_COLORS.length;
}

/**
 * 화자별 인터랙티브 스크립트.
 * 버블을 누르면 해당 start_time으로 시크 요청 → AudioPlayer가 소비해 이동 재생.
 * 현재 재생 위치에 해당하는 세그먼트는 하이라이트된다.
 */
export default function TranscriptViewer({ segments }: TranscriptViewerProps) {
  const positionSec = useAudioStore((s) => s.positionMs) / 1000;
  const requestSeek = useAudioStore((s) => s.requestSeek);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}
    >
      {segments.map((segment) => {
        const color = SPEAKER_COLORS[speakerIndex(segment.speaker_label)];
        const isActive =
          positionSec >= segment.start_time && positionSec < segment.end_time;
        return (
          <Pressable
            key={segment.id}
            className={`mb-2.5 rounded-2xl border px-4 py-3 active:opacity-70 ${color.bubble} ${
              isActive ? 'border-white/70' : ''
            }`}
            onPress={() => requestSeek(segment.start_time * 1000)}
          >
            <View className="mb-1 flex-row items-center justify-between">
              <Text className={`text-xs font-bold ${color.name}`}>
                {segment.speaker_label.replace('Speaker', '화자')}
              </Text>
              <Text className="text-xs tabular-nums text-muted">
                {formatTimestamp(segment.start_time)}
              </Text>
            </View>
            <Text className="text-sm leading-5 text-white">{segment.text}</Text>
          </Pressable>
        );
      })}
      {segments.length === 0 && (
        <Text className="mt-12 text-center text-muted">
          스크립트가 아직 없습니다.
        </Text>
      )}
    </ScrollView>
  );
}
