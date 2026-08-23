import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { createSessionWithUpload } from '../../lib/supabase';
import { startProcessing } from '../../lib/deepgram';
import { extFromName, formatFileSize } from '../../utils/formatters';

const ALLOWED_EXTS = new Set(['m4a', 'mp3', 'wav', 'aac', 'mp4', 'webm']);

type ItemStatus = 'QUEUED' | 'UPLOADING' | 'PROCESSING' | 'FAILED';

interface UploadItem {
  key: string;
  name: string;
  size: number | null;
  uri: string;
  ext: string;
  status: ItemStatus;
  error?: string;
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  QUEUED: '대기',
  UPLOADING: '업로드 중',
  PROCESSING: 'AI 분석 시작됨',
  FAILED: '실패',
};

export default function UploadScreen() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const updateItem = (key: string, patch: Partial<UploadItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const handlePick = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;

    const picked: UploadItem[] = [];
    for (const asset of result.assets) {
      const ext = extFromName(asset.name);
      if (!ALLOWED_EXTS.has(ext)) continue;
      picked.push({
        key: `${asset.uri}-${Date.now()}-${picked.length}`,
        name: asset.name,
        size: asset.size ?? null,
        uri: asset.uri,
        ext,
        status: 'QUEUED',
      });
    }
    if (picked.length === 0) {
      Alert.alert('지원되지 않는 형식', 'm4a / mp3 / wav 파일을 선택해주세요.');
      return;
    }
    setItems(picked);
    setBusy(true);
    // 파일별 순차 파이프라인: 세션 생성 → 업로드 → 분석 시작(fire-and-forget)
    for (const item of picked) {
      updateItem(item.key, { status: 'UPLOADING' });
      try {
        const sessionId = await createSessionWithUpload({
          localUri: item.uri,
          ext: item.ext,
          title: item.name.replace(/\.[A-Za-z0-9]+$/, ''),
          sessionType: 'CALL',
          durationSeconds: null, // Deepgram metadata.duration으로 서버에서 보정
        });
        startProcessing(sessionId);
        updateItem(item.key, { status: 'PROCESSING' });
      } catch (err) {
        updateItem(item.key, {
          status: 'FAILED',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    setBusy(false);
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-6 pb-4 pt-2">
        <Text className="text-2xl font-bold text-white">통화 녹음 가져오기</Text>
        <Text className="text-sm text-muted">
          휴대폰에 저장된 통화 녹음(m4a/mp3/wav)을 일괄 업로드합니다
        </Text>
      </View>

      <View className="px-6">
        <Pressable
          className="items-center rounded-2xl border-2 border-dashed border-border bg-surface py-10 active:opacity-80"
          onPress={handlePick}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#6C5CE7" />
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={40} color="#6C5CE7" />
              <Text className="mt-3 text-base font-semibold text-white">
                파일 선택하기
              </Text>
              <Text className="mt-1 text-xs text-muted">
                여러 파일을 한 번에 선택할 수 있어요
              </Text>
            </>
          )}
        </Pressable>
      </View>

      <FlatList
        className="mt-6"
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View className="mb-2 flex-row items-center rounded-xl border border-border bg-card px-4 py-3">
            <Ionicons
              name={
                item.status === 'FAILED'
                  ? 'alert-circle-outline'
                  : item.status === 'PROCESSING'
                    ? 'checkmark-circle-outline'
                    : 'musical-note-outline'
              }
              size={20}
              color={
                item.status === 'FAILED'
                  ? '#FF5C7A'
                  : item.status === 'PROCESSING'
                    ? '#00D2B4'
                    : '#8B94A7'
              }
            />
            <View className="ml-3 flex-1">
              <Text className="text-sm text-white" numberOfLines={1}>
                {item.name}
              </Text>
              <Text className="text-xs text-muted">
                {formatFileSize(item.size)} · {STATUS_LABEL[item.status]}
                {item.error ? ` — ${item.error}` : ''}
              </Text>
            </View>
            {item.status === 'UPLOADING' && (
              <ActivityIndicator size="small" color="#6C5CE7" />
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}
