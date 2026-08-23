import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import type { ActionItem, Json } from '../types/database.types';

interface ActionItemListProps {
  insightId: string;
  items: ActionItem[];
}

/**
 * 체크 가능한 액션 아이템 리스트.
 * 토글은 ai_insights.action_items JSONB 전체를 다시 쓰는 낙관적 뮤테이션으로 저장.
 * 같은 scope로 직렬화해 연속 토글 시 lost-update를 방지한다 (MVP 알려진 한계:
 * 다중 기기 동시 편집은 last-write-wins).
 */
export default function ActionItemList({ insightId, items }: ActionItemListProps) {
  const [localItems, setLocalItems] = useState<ActionItem[]>(items);

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  const mutation = useMutation({
    scope: { id: `action-items-${insightId}` },
    mutationFn: async (next: ActionItem[]) => {
      const { error } = await supabase
        .from('ai_insights')
        .update({ action_items: next as unknown as Json })
        .eq('id', insightId);
      if (error) throw error;
    },
    onError: (err, _next) => {
      // 실패 시 서버 상태로 롤백
      setLocalItems(items);
      Alert.alert('저장 실패', err instanceof Error ? err.message : String(err));
    },
  });

  const toggle = (id: string) => {
    const next = localItems.map((item) =>
      item.id === id ? { ...item, completed: !item.completed } : item,
    );
    setLocalItems(next);
    mutation.mutate(next);
  };

  const doneCount = localItems.filter((i) => i.completed).length;

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}
    >
      <Text className="mb-3 text-sm text-muted">
        완료 {doneCount} / {localItems.length}
      </Text>
      {localItems.map((item) => (
        <Pressable
          key={item.id}
          className="mb-2.5 flex-row items-start rounded-2xl border border-border bg-card px-4 py-3 active:opacity-80"
          onPress={() => toggle(item.id)}
        >
          <Ionicons
            name={item.completed ? 'checkbox' : 'square-outline'}
            size={22}
            color={item.completed ? '#00D2B4' : '#8B94A7'}
          />
          <View className="ml-3 flex-1">
            <Text
              className={`text-sm leading-5 ${
                item.completed ? 'text-muted line-through' : 'text-white'
              }`}
            >
              {item.task}
            </Text>
            <View className="mt-1.5 flex-row flex-wrap">
              {item.assignee && (
                <View className="mr-2 flex-row items-center rounded-full bg-primary/15 px-2 py-0.5">
                  <Ionicons name="person-outline" size={11} color="#6C5CE7" />
                  <Text className="ml-1 text-xs text-primary">
                    {item.assignee}
                  </Text>
                </View>
              )}
              {item.due_date && (
                <View className="flex-row items-center rounded-full bg-warning/15 px-2 py-0.5">
                  <Ionicons name="calendar-outline" size={11} color="#F5A623" />
                  <Text className="ml-1 text-xs text-warning">
                    {item.due_date}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      ))}
      {localItems.length === 0 && (
        <Text className="mt-12 text-center text-muted">
          추출된 액션 아이템이 없습니다.
        </Text>
      )}
    </ScrollView>
  );
}
