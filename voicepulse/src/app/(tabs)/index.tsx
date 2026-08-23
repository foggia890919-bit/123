import { useCallback } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import type { AudioSession, SessionStatus, SessionType } from '../../types/database.types';
import { formatDuration, formatRelativeDate } from '../../utils/formatters';

const TYPE_META: Record<SessionType, { label: string; color: string }> = {
  CALL: { label: '통화', color: 'bg-accent/20 text-accent' },
  MEETING: { label: '회의', color: 'bg-primary/20 text-primary' },
  NOTE: { label: '메모', color: 'bg-warning/20 text-warning' },
};

const STATUS_META: Record<SessionStatus, { label: string; className: string }> = {
  UPLOADING: { label: '업로드 중', className: 'bg-warning/20 text-warning' },
  PROCESSING: { label: 'AI 분석 중', className: 'bg-primary/20 text-primary' },
  COMPLETED: { label: '완료', className: 'bg-accent/20 text-accent' },
  FAILED: { label: '실패', className: 'bg-danger/20 text-danger' },
};

async function fetchSessions(): Promise<AudioSession[]> {
  const { data, error } = await supabase
    .from('audio_sessions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export default function DashboardScreen() {
  const router = useRouter();

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
    // 처리 중인 세션이 있으면 5초 폴링 (MVP — 실시간 채널은 추후 업그레이드)
    refetchInterval: (query) => {
      const rows = query.state.data;
      const active = rows?.some(
        (s) => s.status === 'PROCESSING' || s.status === 'UPLOADING',
      );
      return active ? 5000 : false;
    },
  });

  const handleLogout = useCallback(() => {
    supabase.auth.signOut();
  }, []);

  const sessions = sessionsQuery.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center justify-between px-6 pb-4 pt-2">
        <View>
          <Text className="text-2xl font-bold text-white">VoicePulse</Text>
          <Text className="text-sm text-muted">나의 녹음 세션</Text>
        </View>
        <Pressable
          onPress={handleLogout}
          className="rounded-full bg-surface p-2 active:opacity-70"
        >
          <Ionicons name="log-out-outline" size={20} color="#8B94A7" />
        </Pressable>
      </View>

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={sessionsQuery.isRefetching}
            onRefresh={() => sessionsQuery.refetch()}
            tintColor="#8B94A7"
          />
        }
        ListEmptyComponent={
          <View className="mt-24 items-center">
            <Ionicons name="mic-circle-outline" size={64} color="#2A3447" />
            <Text className="mt-4 text-center text-muted">
              아직 세션이 없습니다.{'\n'}녹음 탭에서 첫 회의를 기록해보세요.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const type = TYPE_META[item.session_type];
          const status = STATUS_META[item.status];
          return (
            <Pressable
              className="mb-3 rounded-2xl border border-border bg-card p-4 active:opacity-80"
              onPress={() => router.push(`/session/${item.id}`)}
            >
              <View className="flex-row items-center justify-between">
                <View className={`rounded-full px-2.5 py-0.5 ${type.color.split(' ')[0]}`}>
                  <Text className={`text-xs font-semibold ${type.color.split(' ')[1]}`}>
                    {type.label}
                  </Text>
                </View>
                <View className={`rounded-full px-2.5 py-0.5 ${status.className.split(' ')[0]}`}>
                  <Text
                    className={`text-xs font-semibold ${status.className.split(' ')[1]}`}
                  >
                    {status.label}
                  </Text>
                </View>
              </View>
              <Text className="mt-2 text-base font-semibold text-white" numberOfLines={1}>
                {item.title || '제목 없는 세션'}
              </Text>
              <View className="mt-2 flex-row items-center">
                <Ionicons name="time-outline" size={14} color="#8B94A7" />
                <Text className="ml-1 mr-4 text-xs text-muted">
                  {formatDuration(item.duration_seconds)}
                </Text>
                <Ionicons name="calendar-outline" size={14} color="#8B94A7" />
                <Text className="ml-1 text-xs text-muted">
                  {formatRelativeDate(item.created_at)}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
