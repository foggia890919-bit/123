import { describe, it, expect } from "vitest";
import { matchKeyword, DEFAULT_RULES } from "./keyword-match";
import type { KeywordRule } from "@prisma/client";

const rules = DEFAULT_RULES.map((r, i) => ({
  ...r,
  id: `r${i}`,
  workspaceId: "w",
  bottlesRule: null,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})) as unknown as KeywordRule[];

describe("matchKeyword", () => {
  it("피쿠알 1병 → 피쿠알/1", () => {
    const r = matchKeyword("피쿠알 1병", rules);
    expect(r.keyword).toBe("피쿠알");
    expect(r.bottlesPerUnit).toBe(1);
  });
  it("아르베키나 2병 세트 → 아르베키나/2", () => {
    const r = matchKeyword("아르베키나 2병 세트", rules);
    expect(r.keyword).toBe("아르베키나");
    expect(r.bottlesPerUnit).toBe(2);
  });
  it("블렌딩 3병 세트 → 블렌딩/3", () => {
    const r = matchKeyword("블렌딩 3병 세트", rules);
    expect(r.keyword).toBe("블렌딩");
    expect(r.bottlesPerUnit).toBe(3);
  });
  it("Picual 1 bottle → 피쿠알/1", () => {
    const r = matchKeyword("Picual 1 bottle", rules);
    expect(r.keyword).toBe("피쿠알");
    expect(r.bottlesPerUnit).toBe(1);
  });
  it("아무것도 매칭 안되면 빈 키워드 + 1병", () => {
    const r = matchKeyword("랜덤 옵션 5색상", rules);
    expect(r.keyword).toBe("");
    expect(r.bottlesPerUnit).toBe(1);
  });
  it("우선순위 우선 — 더 높은 priority 가 이김", () => {
    const customRules: KeywordRule[] = [
      { id: "1", workspaceId: "w", keyword: "특제", patterns: "특제", priority: 100, bottlesRule: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
      { id: "2", workspaceId: "w", keyword: "기본", patterns: "특제", priority: 1, bottlesRule: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ];
    const r = matchKeyword("특제 옵션", customRules);
    expect(r.keyword).toBe("특제");
  });
  it("regex 패턴 (/.../i) 도 동작", () => {
    const customRules: KeywordRule[] = [
      { id: "1", workspaceId: "w", keyword: "오일", patterns: "/oil|기름/i", priority: 10, bottlesRule: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ];
    expect(matchKeyword("Olive Oil 1병", customRules).keyword).toBe("오일");
    expect(matchKeyword("참기름 1병", customRules).keyword).toBe("오일");
  });
  it("disabled 룰은 스킵", () => {
    const customRules: KeywordRule[] = [
      { id: "1", workspaceId: "w", keyword: "X", patterns: "피쿠알", priority: 100, bottlesRule: null, enabled: false, createdAt: new Date(), updatedAt: new Date() },
      ...(DEFAULT_RULES.map((r, i) => ({ ...r, id: `d${i}`, workspaceId: "w", bottlesRule: null, enabled: true, createdAt: new Date(), updatedAt: new Date() })) as unknown as KeywordRule[]),
    ];
    expect(matchKeyword("피쿠알 1병", customRules).keyword).toBe("피쿠알");
  });
});
