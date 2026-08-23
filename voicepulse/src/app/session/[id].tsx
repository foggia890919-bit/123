import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { getSignedAudioUrl, supabase } from '../../lib/supabase';
import { invokeProcessAudio } from '../../lib/deepgram';
import AudioPlayer from '../../components/AudioPlayer';
import TranscriptViewer from '../../components/TranscriptViewer';
import ActionItemList from '../../components/ActionItemList';
import MindmapViewer from '../../components/MindmapViewer';
import {
  parseInsight,
  type AiInsight,
  type AudioSession,
  type TranscriptSegment,
} from '../../types/database.types';
import { formatDuration, formatRelativeDate } from '../../utils/formatters';

type DetailTab = 'insights' | 'transcript' | 'actions' | 'mindmap';

const TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'insights', label: '요약' },
  { key: 'transcript', label: '스크립트' },
  { key: 'actions', label: '할 일' },
  { key: 'mindmap', label: '마인드맵' },
];

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DetailTab>('insights');
  const [retrying, setRetrying] = useState(false);

  const sessionQuery = useQuery({
    queryKey: ['session', id],
    enabled: !!id,
    queryFn: async (): Promise<AudioSession | null> => {
      const { data, error } = await supabase
        .from('audio_sessions')
        .select('*')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    // 처리 중이면 4초 폴링으로 완료 감지
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PROCESSING' || status === 'UPLOADING' ? 4000 : false;
    },
  });

  const session = sessionQuery.data;
  const isCompleted = session?.status === 'COMPLETED';

  const segmentsQuery = useQuery({
    queryKey: ['segments', id],
    enabled: !!id && isCompleted,
    queryFn: async (): Promise<TranscriptSegment[]> => {
      const { data, error } = await supabase
        .from('transcript_segments')
        .select('*')
        .eq('session_id', id!)
        .order('start_time', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const insightQuery = useQuery({
    queryKey: ['insight', id],
    enabled: !!id && isCompleted,
    queryFn: async (): Promise<AiInsight | null> => {
      const { data, error } = await supabase
        .from('ai_insights')
        .select('*')
        .eq('session_id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const audioUrlQuery = useQuery({
    queryKey: ['audio-url', id, session?.audio_url],
    enabled: !!session?.audio_url,
    staleTime: 55 * 60 * 1000, // 서명 URL 유효기간(1h)보다 짧게
    queryFn: () => getSignedAudioUrl(session!.audio_url!),
  });

  const handleRetry = async () => {
    if (!id) return;
    setRetrying(true);
    try {
      await invokeProcessAudio(id);
    } catch {
      // 처리 시작 실패해도 폴링이 상태를 반영하므로 조용히 넘어간다
    } finally {
      setRetrying(false);
      queryClient.invalidateQueries({ queryKey: ['session', id] });
    }
  };

  const insight = parseInsight(insightQuery.data);

  if (sessionQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#6C5CE7" size="large" />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-muted">세션을 찾을 수 없습니다.</Text>
        <Pressable className="mt-4" onPress={() => router.back()}>
          <Text className="text-accent">돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* 헤더 */}
      <View className="flex-row items-center px-4 pb-3 pt-2">
        <Pressable
          className="mr-2 rounded-full p-2 active:opacity-70"
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-white" numberOfLines={1}>
            {session.title || '제목 없는 세션'}
          </Text>
          <Text className="text-xs text-muted">
            {formatRelativeDate(session.created_at)} ·{' '}
            {formatDuration(session.duration_seconds)}
          </Text>
        </View>
      </View>

      {/* 처리 중 / 실패 상태 */}
      {!isCompleted && (
        <View className="flex-1 items-center justify-center px-8">
          {session.status === 'FAILED' ? (
            <>
              <Ionicons name="alert-circle-outline" size={56} color="#FF5C7A" />
              <Text className="mt-4 text-center text-base font-semibold text-white">
                분석에 실패했습니다
              </Text>
              {session.error_message && (
                <Text className="mt-2 text-center text-xs text-muted">
                  {session.error_message}
                </Text>
              )}
              <Pressable
                className="mt-6 flex-row items-center rounded-xl bg-primary px-6 py-3 active:opacity-80"
                onPress={handleRetry}
                disabled={retrying}
              >
                {retrying ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="refresh" size={18} color="#fff" />
                    <Text className="ml-2 font-semibold text-white">
                      다시 시도
                    </Text>
                  </>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator color="#6C5CE7" size="large" />
              <Text className="mt-4 text-center text-base font-semibold text-white">
                {session.status === 'UPLOADING'
                  ? '오디오 업로드 중…'
                  : 'AI가 분석하고 있어요…'}
              </Text>
              <Text className="mt-2 text-center text-xs text-muted">
                화자 분리 STT와 요약 생성에 수 분이 걸릴 수 있습니다.
              </Text>
            </>
          )}
        </View>
      )}

      {/* 완료: 탭 컨텐츠 */}
      {isCompleted && (
        <>
          <View className="mx-4 mb-3 flex-row rounded-xl bg-surface p-1">
            {TABS.map((t) => (
              <Pressable
                key={t.key}
                className={`flex-1 items-center rounded-lg py-2 ${
                  tab === t.key ? 'bg-primary' : ''
                }`}
                onPress={() => setTab(t.key)}
              >
                <Text
                  className={`text-xs font-semibold ${
                    tab === t.key ? 'text-white' : 'text-muted'
                  }`}
                >
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="flex-1 px-4">
            {tab === 'insights' && (
              <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingBottom: 40 }}
              >
                <View className="mb-4 rounded-2xl border border-border bg-card p-4">
                  <Text className="mb-2 text-xs font-bold uppercase text-accent">
                    TL;DR
                  </Text>
                  <Text className="text-sm leading-6 text-white">
                    {insight.summary?.overview ?? '요약이 없습니다.'}
                  </Text>
                </View>

                {(insight.summary?.key_points?.length ?? 0) > 0 && (
                  <View className="mb-4 rounded-2xl border border-border bg-card p-4">
                    <Text className="mb-2 text-xs font-bold uppercase text-primary">
                      핵심 포인트
                    </Text>
                    {insight.summary!.key_points.map((point, idx) => (
                      <View key={idx} className="mb-1.5 flex-row">
                        <Text className="mr-2 text-primary">•</Text>
                        <Text className="flex-1 text-sm leading-5 text-white/90">
                          {point}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                <Text className="mb-2 text-xs font-bold uppercase text-warning">
                  결정 사항
                </Text>
                {insight.decisions.length === 0 && (
                  <Text className="text-sm text-muted">
                    기록된 결정 사항이 없습니다.
                  </Text>
                )}
                {insight.decisions.map((decision, idx) => (
                  <View
                    key={idx}
                    className="mb-2.5 rounded-2xl border border-border bg-card p-4"
                  >
                    <Text className="text-sm font-semibold leading-5 text-white">
                      {decision.decision}
                    </Text>
                    {decision.context ? (
                      <Text className="mt-1 text-xs leading-4 text-muted">
                        {decision.context}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
            )}

            {tab === 'transcript' && (
              <View className="flex-1">
                {audioUrlQuery.data && (
                  <AudioPlayer uri={audioUrlQuery.data} sessionId={session.id} />
                )}
                <TranscriptViewer segments={segmentsQuery.data ?? []} />
              </View>
            )}

            {tab === 'actions' &&
              (insightQuery.data ? (
                <ActionItemList
                  insightId={insightQuery.data.id}
                  items={insight.actionItems}
                />
              ) : (
                <Text className="mt-12 text-center text-muted">
                  액션 아이템이 없습니다.
                </Text>
              ))}

            {tab === 'mindmap' && <MindmapViewer root={insight.mindmap} />}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
