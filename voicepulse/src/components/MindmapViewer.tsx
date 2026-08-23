import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MindmapNode } from '../types/database.types';

interface MindmapViewerProps {
  root: MindmapNode | null;
}

const DEPTH_COLORS = ['#6C5CE7', '#00D2B4', '#F5A623', '#FF5C7A', '#8B94A7'];

function NodeRow({ node, depth }: { node: MindmapNode; depth: number }) {
  // 루트/1단계는 펼침, 2단계 이상은 접힘으로 시작
  const [expanded, setExpanded] = useState(depth < 2);
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const color = DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];

  return (
    <View style={{ marginLeft: depth === 0 ? 0 : 16 }}>
      <Pressable
        className="mb-1.5 flex-row items-center rounded-xl bg-card px-3 py-2.5 active:opacity-70"
        style={{ borderLeftWidth: 3, borderLeftColor: color }}
        onPress={() => hasChildren && setExpanded((prev) => !prev)}
        disabled={!hasChildren}
      >
        {hasChildren ? (
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={color}
          />
        ) : (
          <View className="ml-1 mr-1 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
        )}
        <Text
          className={`ml-2 flex-1 ${
            depth === 0
              ? 'text-base font-bold text-white'
              : depth === 1
                ? 'text-sm font-semibold text-white'
                : 'text-sm text-white/80'
          }`}
        >
          {node.label}
        </Text>
        {hasChildren && !expanded && (
          <Text className="text-xs text-muted">{children.length}</Text>
        )}
      </Pressable>
      {expanded &&
        children.map((child, idx) => (
          <NodeRow key={`${depth}-${idx}-${child.label}`} node={child} depth={depth + 1} />
        ))}
    </View>
  );
}

/** 노드 펼치기/접기가 가능한 계층형 마인드맵 트리 렌더러 */
export default function MindmapViewer({ root }: MindmapViewerProps) {
  if (!root) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-muted">마인드맵 데이터가 없습니다.</Text>
      </View>
    );
  }
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}
    >
      <NodeRow node={root} depth={0} />
    </ScrollView>
  );
}
