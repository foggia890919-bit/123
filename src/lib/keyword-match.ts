import type { KeywordRule } from "@prisma/client";

export interface MatchResult {
  keyword: string;
  bottlesPerUnit: number;
  matchedBy?: string; // 매칭된 패턴 (디버깅용)
}

const DEFAULT_BOTTLES_REGEX = /(\d+)\s*(?:병|개|입|set|세트|팩|pack|bottle)/i;

function splitPatterns(s: string): string[] {
  return s.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 옵션 텍스트에 룰을 적용해 (키워드, 병수) 반환. 매칭 안되면 빈 결과. */
export function matchKeyword(
  optionName: string,
  rules: Pick<KeywordRule, "keyword" | "patterns" | "priority" | "bottlesRule" | "enabled">[],
): MatchResult {
  const text = optionName ?? "";
  const sortedRules = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority || b.patterns.length - a.patterns.length);

  let matched: { keyword: string; pattern: string; bottlesRule: string | null } | null = null;
  for (const r of sortedRules) {
    const patterns = splitPatterns(r.patterns);
    for (const p of patterns) {
      try {
        // 정규식 형태(/.../) 면 그대로, 아니면 단순 포함 매칭(대소문자 무시)
        const re = p.startsWith("/") && p.lastIndexOf("/") > 0
          ? new RegExp(p.slice(1, p.lastIndexOf("/")), p.slice(p.lastIndexOf("/") + 1))
          : new RegExp(escapeRegex(p), "i");
        if (re.test(text)) {
          matched = { keyword: r.keyword, pattern: p, bottlesRule: r.bottlesRule ?? null };
          break;
        }
      } catch {
        if (text.toLowerCase().includes(p.toLowerCase())) {
          matched = { keyword: r.keyword, pattern: p, bottlesRule: r.bottlesRule ?? null };
          break;
        }
      }
    }
    if (matched) break;
  }

  let bottles = 1;
  const bottlesRegexSrc = matched?.bottlesRule || null;
  let bottlesRegex: RegExp = DEFAULT_BOTTLES_REGEX;
  if (bottlesRegexSrc) {
    try { bottlesRegex = new RegExp(bottlesRegexSrc); } catch { /* ignore */ }
  }
  const m = text.match(bottlesRegex);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) bottles = n;
  }

  return {
    keyword: matched?.keyword ?? "",
    bottlesPerUnit: bottles,
    matchedBy: matched?.pattern,
  };
}

/** 워크스페이스 첫 생성 시 자동 시드 — 사장님이 자주 쓰는 3개 */
export const DEFAULT_RULES: { keyword: string; patterns: string; priority: number }[] = [
  { keyword: "피쿠알", patterns: "피쿠알,picual,Picual,PICUAL", priority: 10 },
  { keyword: "아르베키나", patterns: "아르베키나,arbequina,Arbequina,ARBEQUINA", priority: 10 },
  { keyword: "블렌딩", patterns: "블렌딩,blending,Blending,BLENDING,blend,혼합", priority: 10 },
];
