// Supabase 스키마 타입 (supabase gen types 형태를 수기로 작성)
// 스키마 원본: supabase/migrations/20260824_init_schema.sql

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type SessionType = 'CALL' | 'MEETING' | 'NOTE';
export type SessionStatus = 'UPLOADING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface Database {
  public: {
    Tables: {
      audio_sessions: {
        Row: {
          id: string;
          user_id: string;
          session_type: SessionType;
          title: string;
          audio_url: string | null;
          duration_seconds: number | null;
          status: SessionStatus;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_type?: SessionType;
          title?: string;
          audio_url?: string | null;
          duration_seconds?: number | null;
          status?: SessionStatus;
          error_message?: string | null;
          created_at?: string;
        };
        Update: {
          title?: string;
          audio_url?: string | null;
          duration_seconds?: number | null;
        };
        Relationships: [];
      };
      transcript_segments: {
        Row: {
          id: string;
          session_id: string;
          speaker_label: string;
          start_time: number;
          end_time: number;
          text: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          speaker_label: string;
          start_time: number;
          end_time: number;
          text: string;
        };
        Update: {
          speaker_label?: string;
          start_time?: number;
          end_time?: number;
          text?: string;
        };
        Relationships: [];
      };
      ai_insights: {
        Row: {
          id: string;
          session_id: string;
          summary: Json | null;
          decisions: Json | null;
          action_items: Json | null;
          mindmap_data: Json | null;
          raw_response: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          summary?: Json | null;
          decisions?: Json | null;
          action_items?: Json | null;
          mindmap_data?: Json | null;
          raw_response?: Json | null;
          created_at?: string;
        };
        Update: {
          action_items?: Json | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      session_type: SessionType;
      session_status: SessionStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type AudioSession = Database['public']['Tables']['audio_sessions']['Row'];
export type TranscriptSegment =
  Database['public']['Tables']['transcript_segments']['Row'];
export type AiInsight = Database['public']['Tables']['ai_insights']['Row'];

// ── AI 산출물(JSONB) 파싱 타입 — Edge Function의 Claude 스키마와 동일 ──

export interface SummaryData {
  overview: string;
  key_points: string[];
}

export interface Decision {
  decision: string;
  context: string;
}

export interface ActionItem {
  id: string;
  task: string;
  assignee: string | null;
  due_date: string | null;
  completed: boolean;
}

export interface MindmapNode {
  label: string;
  children?: MindmapNode[];
}

export interface ParsedInsight {
  summary: SummaryData | null;
  decisions: Decision[];
  actionItems: ActionItem[];
  mindmap: MindmapNode | null;
}

/** ai_insights 행의 JSONB 컬럼들을 앱에서 쓰는 구조로 안전 캐스팅 */
export function parseInsight(row: AiInsight | null | undefined): ParsedInsight {
  if (!row) {
    return { summary: null, decisions: [], actionItems: [], mindmap: null };
  }
  return {
    summary: (row.summary as unknown as SummaryData) ?? null,
    decisions: (row.decisions as unknown as Decision[]) ?? [],
    actionItems: (row.action_items as unknown as ActionItem[]) ?? [],
    mindmap: (row.mindmap_data as unknown as MindmapNode) ?? null,
  };
}
