// VoicePulse — process-audio Edge Function (Deno)
//
// POST { session_id } + Authorization: Bearer <user JWT>
// 1) 세션 소유권 검증 → 2) 상태 원자적 선점(UPLOADING/FAILED → PROCESSING)
// 3) 기존 세그먼트 삭제(재시도 멱등성) → 4) Deepgram Nova-2 diarized STT
// 5) transcript_segments 배치 삽입 → 6) Claude 구조화(JSON) → 7) ai_insights upsert
// 8) 세션 COMPLETED (실패 시 FAILED + error_message)
//
// 필요 시크릿: DEEPGRAM_API_KEY, ANTHROPIC_API_KEY
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 런타임 자동 주입)

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const AUDIO_BUCKET = "audio-recordings";
const DEEPGRAM_URL =
  "https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&smart_format=true&punctuate=true&utterances=true&language=ko";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// 재현성을 위해 -latest 별칭 대신 날짜 스냅샷으로 고정
const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";
const SEGMENT_INSERT_CHUNK = 200;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SegmentRow {
  session_id: string;
  speaker_label: string;
  start_time: number;
  end_time: number;
  text: string;
}

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number;
}

interface DeepgramUtterance {
  start: number;
  end: number;
  transcript: string;
  speaker?: number;
}

interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: {
    utterances?: DeepgramUtterance[];
    channels?: Array<{
      alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }>;
    }>;
  };
}

interface ClaudeActionItem {
  id: string;
  task: string;
  assignee: string | null;
  due_date: string | null;
  completed: boolean;
}

interface ClaudeStructuredOutput {
  inferred_session_type: "CALL" | "MEETING" | "NOTE";
  title: string;
  summary: { overview: string; key_points: string[] };
  decisions: Array<{ decision: string; context: string }>;
  action_items: ClaudeActionItem[];
  mindmap: { label: string; children?: unknown[] };
}

const SYSTEM_PROMPT = `당신은 한국어 회의/통화 녹음 스크립트를 구조화하는 분석 엔진입니다.
화자 라벨이 붙은 스크립트를 읽고, 아래 JSON 스키마에 정확히 일치하는 JSON 객체 하나만 출력하세요.
마크다운, 코드 펜스, 설명 문장 없이 순수 JSON만 출력합니다.

스키마:
{
  "inferred_session_type": "CALL" | "MEETING" | "NOTE",  // 통화=CALL, 다자 회의=MEETING, 혼잣말 메모=NOTE
  "title": string,                                        // 내용을 요약한 간결한 한국어 제목 (20자 내외)
  "summary": {
    "overview": string,                                   // 3~5문장 TL;DR
    "key_points": string[]                                // 핵심 포인트 3~7개
  },
  "decisions": [ { "decision": string, "context": string } ],   // 확정된 결정 사항 (없으면 빈 배열)
  "action_items": [
    {
      "id": string,              // "ai-1", "ai-2" 같은 고유 문자열
      "task": string,            // 할 일 내용
      "assignee": string | null, // 담당자 이름 (언급 없으면 null)
      "due_date": string | null, // "YYYY-MM-DD" (언급 없으면 null)
      "completed": false
    }
  ],
  "mindmap": {                   // 주제 계층 트리 (2~3 depth)
    "label": string,
    "children": [ { "label": string, "children": [...] } ]
  }
}

규칙:
- 스크립트에 근거가 없는 내용을 지어내지 마세요.
- 날짜는 스크립트에 언급된 경우에만 due_date로 추출하세요.
- 모든 텍스트 필드는 한국어로 작성하세요.`;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** utterances가 없을 때 word 단위 응답을 화자별 연속 구간으로 묶는 폴백 */
function groupWordsBySpeaker(words: DeepgramWord[]): DeepgramUtterance[] {
  const utterances: DeepgramUtterance[] = [];
  let current: { speaker: number; start: number; end: number; parts: string[] } | null = null;

  for (const w of words) {
    const speaker = w.speaker ?? 0;
    const text = w.punctuated_word ?? w.word;
    if (current && current.speaker === speaker) {
      current.end = w.end;
      current.parts.push(text);
    } else {
      if (current) {
        utterances.push({
          speaker: current.speaker,
          start: current.start,
          end: current.end,
          transcript: current.parts.join(" "),
        });
      }
      current = { speaker, start: w.start, end: w.end, parts: [text] };
    }
  }
  if (current) {
    utterances.push({
      speaker: current.speaker,
      start: current.start,
      end: current.end,
      transcript: current.parts.join(" "),
    });
  }
  return utterances;
}

async function transcribeWithDeepgram(signedUrl: string): Promise<DeepgramResponse> {
  const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY secret이 설정되지 않았습니다");

  const res = await fetch(DEEPGRAM_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: signedUrl }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Deepgram 오류 (${res.status}): ${detail.slice(0, 500)}`);
  }
  return (await res.json()) as DeepgramResponse;
}

function tryParseClaudeJson(text: string): ClaudeStructuredOutput | null {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as ClaudeStructuredOutput;
    if (!parsed.summary || !Array.isArray(parsed.action_items) || !parsed.mindmap) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function callClaudeOnce(
  transcript: string,
): Promise<{ parsed: ClaudeStructuredOutput | null; raw: unknown }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY secret이 설정되지 않았습니다");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `다음 다이어라이제이션 스크립트를 스키마에 맞는 JSON으로 구조화하세요.\n\n${transcript}`,
        },
        // assistant prefill: JSON 이외의 서두 출력을 차단
        { role: "assistant", content: "{" },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API 오류 (${res.status}): ${detail.slice(0, 500)}`);
  }
  const raw = await res.json();
  const textBlock = (raw?.content ?? []).find(
    (b: { type?: string }) => b?.type === "text",
  ) as { text?: string } | undefined;
  const combined = "{" + (textBlock?.text ?? "");
  return { parsed: tryParseClaudeJson(combined), raw };
}

async function structureWithClaude(
  transcript: string,
): Promise<{ parsed: ClaudeStructuredOutput; raw: unknown }> {
  const first = await callClaudeOnce(transcript);
  if (first.parsed) return { parsed: first.parsed, raw: first.raw };
  const second = await callClaudeOnce(transcript);
  if (second.parsed) return { parsed: second.parsed, raw: second.raw };
  throw new Error("Claude 응답을 JSON으로 파싱하지 못했습니다 (2회 시도)");
}

async function markFailed(admin: SupabaseClient, sessionId: string, message: string) {
  await admin
    .from("audio_sessions")
    .update({ status: "FAILED", error_message: message.slice(0, 1000) })
    .eq("id", sessionId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json(405, { error: "POST만 지원합니다" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 요청/인증 검증 ──
  let sessionId: string | undefined;
  try {
    const body = await req.json();
    sessionId = body?.session_id;
  } catch {
    return json(400, { error: "JSON body가 필요합니다" });
  }
  if (!sessionId || typeof sessionId !== "string") {
    return json(400, { error: "session_id가 필요합니다" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return json(401, { error: "인증에 실패했습니다" });
  }
  const userId = userData.user.id;

  const { data: session, error: sessionError } = await admin
    .from("audio_sessions")
    .select("id, user_id, audio_url, title, duration_seconds, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) return json(500, { error: sessionError.message });
  if (!session || session.user_id !== userId) {
    return json(404, { error: "세션을 찾을 수 없습니다" });
  }
  if (!session.audio_url) {
    return json(400, { error: "audio_url이 아직 설정되지 않았습니다" });
  }

  // ── 상태 원자적 선점: 동시 중복 처리 방지 ──
  const { data: claimed, error: claimError } = await admin
    .from("audio_sessions")
    .update({ status: "PROCESSING", error_message: null })
    .eq("id", sessionId)
    .in("status", ["UPLOADING", "FAILED"])
    .select("id");
  if (claimError) return json(500, { error: claimError.message });
  if (!claimed || claimed.length === 0) {
    return json(409, {
      error: "이미 처리 중이거나 완료된 세션입니다",
      session_id: sessionId,
    });
  }

  try {
    // ── 재시도 멱등성: 이전 실행이 남긴 세그먼트 제거 ──
    const { error: deleteError } = await admin
      .from("transcript_segments")
      .delete()
      .eq("session_id", sessionId);
    if (deleteError) throw new Error(`기존 세그먼트 삭제 실패: ${deleteError.message}`);

    // ── 서명 URL 생성 후 Deepgram URL 모드 호출 ──
    const { data: signed, error: signError } = await admin.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(session.audio_url, 3600);
    if (signError || !signed?.signedUrl) {
      throw new Error(`서명 URL 생성 실패: ${signError?.message ?? "unknown"}`);
    }

    const dg = await transcribeWithDeepgram(signed.signedUrl);
    let utterances = dg.results?.utterances ?? [];
    if (utterances.length === 0) {
      const words = dg.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
      utterances = groupWordsBySpeaker(words);
    }
    if (utterances.length === 0) {
      throw new Error("Deepgram이 음성을 인식하지 못했습니다 (빈 스크립트)");
    }

    const segments: SegmentRow[] = utterances.map((u) => ({
      session_id: sessionId as string,
      speaker_label: `Speaker ${(u.speaker ?? 0) + 1}`,
      start_time: u.start,
      end_time: u.end,
      text: u.transcript,
    }));

    for (let i = 0; i < segments.length; i += SEGMENT_INSERT_CHUNK) {
      const chunk = segments.slice(i, i + SEGMENT_INSERT_CHUNK);
      const { error: insertError } = await admin
        .from("transcript_segments")
        .insert(chunk);
      if (insertError) {
        throw new Error(`세그먼트 삽입 실패: ${insertError.message}`);
      }
    }

    // ── 다이어라이제이션 스크립트 → Claude 구조화 ──
    const transcriptText = segments
      .map((s) => `[${s.speaker_label}] (${formatClock(s.start_time)}) ${s.text}`)
      .join("\n");

    const { parsed, raw } = await structureWithClaude(transcriptText);

    const actionItems: ClaudeActionItem[] = (parsed.action_items ?? []).map(
      (item, idx) => ({
        id: item.id || `ai-${idx + 1}-${crypto.randomUUID().slice(0, 8)}`,
        task: item.task,
        assignee: item.assignee ?? null,
        due_date: item.due_date ?? null,
        completed: item.completed === true,
      }),
    );

    const { data: insight, error: upsertError } = await admin
      .from("ai_insights")
      .upsert(
        {
          session_id: sessionId,
          summary: parsed.summary,
          decisions: parsed.decisions ?? [],
          action_items: actionItems,
          mindmap_data: parsed.mindmap,
          raw_response: raw,
        },
        { onConflict: "session_id" },
      )
      .select("id")
      .single();
    if (upsertError) throw new Error(`ai_insights 저장 실패: ${upsertError.message}`);

    // ── 세션 완료 처리 (추론된 유형 + 비어 있으면 제목 채움 + duration 보정) ──
    const sessionUpdate: Record<string, unknown> = {
      status: "COMPLETED",
      session_type: parsed.inferred_session_type ?? "NOTE",
      error_message: null,
    };
    if (!session.title && parsed.title) sessionUpdate.title = parsed.title;
    if (!session.duration_seconds && dg.metadata?.duration) {
      sessionUpdate.duration_seconds = dg.metadata.duration;
    }
    const { error: completeError } = await admin
      .from("audio_sessions")
      .update(sessionUpdate)
      .eq("id", sessionId);
    if (completeError) throw new Error(`세션 완료 갱신 실패: ${completeError.message}`);

    return json(200, {
      success: true,
      session_id: sessionId,
      segments_count: segments.length,
      insight_id: insight?.id ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[process-audio] 실패:", message);
    await markFailed(admin, sessionId, message);
    return json(500, { error: message, session_id: sessionId });
  }
});
