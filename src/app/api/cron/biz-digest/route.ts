import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/app/api/telegram/send/route";

// ─── 메뉴 매핑 ────────────────────────────────────────────────────────────────
const MENU_MAP: Record<string, string> = {
  "src/app/biz/clients/":           "병·의원 관리",
  "src/app/biz/dealers/":           "법인 관리",
  "src/app/biz/sales-reps/":        "영업사원 관리",
  "src/app/biz/submission-routes/": "통계제출처 관리",
  "src/app/biz/rates/":             "요율 업데이트",
  "src/app/biz/co-promotion/":      "코프로모션 예외",
  "src/app/biz/settlement/":        "정산 관리",
  "src/app/biz/filter-status/":     "필터링 현황",
  "src/app/biz/filter-mapping/":    "제약사→상위법인 매핑",
  "src/app/biz/corp-rates/":        "법인×제약사 추가수수료",
  "src/app/biz/team-status/":       "팀 상태 대시보드",
  "src/app/biz/inventory-status/":  "재고 크롤러 현황",
  "prisma/":                        "DB 스키마",
  "worker/":                        "재고 크롤러 워커",
  "src/scrapers/":                  "크롤러 어댑터",
  ".claude/":                       "PM 메타",
};

// ─── 담당 Dev 매핑 ────────────────────────────────────────────────────────────
const COMMIT_DEV_MAP: Record<string, string> = {
  "feat(rates)":       "Dev3 요율",
  "feat(settlement)":  "Dev4 정산",
  "feat(dealers)":     "Dev1 거래처/유저",
  "feat(submission)":  "Dev2 통계제출처",
  "feat(filter)":      "Dev5 필터링",
  "feat(crawler)":     "Dev6 크롤러",
  "fix(crawler)":      "Dev6 크롤러",
  "feat(search)":      "Dev7 검색엔진",
  "feat(team-status)": "PM 메타",
  "feat(telegram)":    "PM 메타",
  "chore(meta)":       "PM 메타",
  "chore(ops)":        "PM 메타",
  "chore(agents)":     "PM 메타",
  "refactor(biz)":     "PM 메타",
};

// 전체 Dev 목록 (0인 Dev도 표시)
const ALL_DEVS = [
  "Dev1 거래처/유저",
  "Dev2 통계제출처",
  "Dev3 요율",
  "Dev4 정산",
  "Dev5 필터링",
  "Dev6 크롤러",
  "Dev7 검색엔진",
  "PM 메타",
];

// ─── 기여도 막대 ──────────────────────────────────────────────────────────────
const FRACTION_BLOCKS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

function buildBar(lines: number, maxLines: number, maxBlocks = 20): string {
  if (maxLines === 0) return "";
  const ratio = Math.min(lines / maxLines, 1);
  const totalUnits = ratio * maxBlocks * 8; // 8 sub-units per block
  const full = Math.floor(totalUnits / 8);
  const frac = Math.floor(totalUnits % 8);
  return "█".repeat(full) + (frac > 0 ? FRACTION_BLOCKS[frac] : "");
}

// ─── KST 날짜 유틸 ───────────────────────────────────────────────────────────
function nowKST(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function kstDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** KST 어제 00:00 ~ 23:59:59 UTC 범위 반환 */
function yesterdayKSTRange(): { start: Date; end: Date } {
  const kst = nowKST();
  // KST 오늘 00:00 = UTC 어제 15:00
  const kstMidnight = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 0, 0, 0)
  );
  // kstMidnight은 KST 기준 오늘 00:00의 UTC 시각이므로 UTC -9
  const todayKSTasUTC = new Date(kstMidnight.getTime() - 9 * 60 * 60 * 1000);
  const end = new Date(todayKSTasUTC.getTime() - 1000); // 어제 23:59:59
  const start = new Date(todayKSTasUTC.getTime() - 24 * 60 * 60 * 1000); // 어제 00:00:00
  return { start, end };
}

// ─── Git 헬퍼 ────────────────────────────────────────────────────────────────
interface GitStats {
  commitCount: number;
  added: number;
  deleted: number;
  changedMenus: string[];
  devLines: Record<string, number>;
}

function tryGit(cwd: string): GitStats | null {
  try {
    // 어제 KST 범위 → --after / --before (git은 로컬 TZ 기준이므로 ISO 사용)
    const { start, end } = yesterdayKSTRange();
    const after = start.toISOString();
    const before = end.toISOString();

    // 커밋 목록: "%H\t%an\t%s\t%ai"
    const logRaw = execSync(
      `git -C "${cwd}" log --after="${after}" --before="${before}" --format="%H\t%an\t%s\t%ai"`,
      { timeout: 15000, stdio: ["pipe", "pipe", "pipe"] }
    )
      .toString()
      .trim();

    if (!logRaw) {
      return { commitCount: 0, added: 0, deleted: 0, changedMenus: [], devLines: {} };
    }

    const commits = logRaw
      .split("\n")
      .map((line) => {
        const [hash, author, subject] = line.split("\t");
        return { hash, author, subject };
      })
      .filter((c) => c.hash);

    // 전체 shortstat
    const shortstatRaw = execSync(
      `git -C "${cwd}" log --after="${after}" --before="${before}" --shortstat --format=""`,
      { timeout: 15000, stdio: ["pipe", "pipe", "pipe"] }
    ).toString();

    let totalAdded = 0;
    let totalDeleted = 0;
    const addedRx = /(\d+) insertion/g;
    const delRx = /(\d+) deletion/g;
    for (const m of shortstatRaw.matchAll(addedRx)) totalAdded += parseInt(m[1]);
    for (const m of shortstatRaw.matchAll(delRx)) totalDeleted += parseInt(m[1]);

    // 변경 파일 추출 (메뉴 매핑)
    const filesRaw = execSync(
      `git -C "${cwd}" log --after="${after}" --before="${before}" --name-only --format=""`,
      { timeout: 15000, stdio: ["pipe", "pipe", "pipe"] }
    ).toString();

    const changedMenuSet = new Set<string>();
    for (const file of filesRaw.split("\n").map((f) => f.trim()).filter(Boolean)) {
      for (const [prefix, menu] of Object.entries(MENU_MAP)) {
        if (file.startsWith(prefix)) {
          changedMenuSet.add(menu);
          break;
        }
      }
    }

    // Dev별 라인 집계 (commit별 numstat)
    const devLines: Record<string, number> = {};
    for (const commit of commits) {
      const numstatRaw = execSync(
        `git -C "${cwd}" show --numstat --format="" ${commit.hash}`,
        { timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
      ).toString();

      let commitAdded = 0;
      for (const line of numstatRaw.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
          commitAdded += parseInt(parts[0]);
        }
      }

      // 담당 Dev 결정: commit subject prefix 먼저, 없으면 author명
      let dev = commit.author ?? "기타";
      for (const [prefix, devName] of Object.entries(COMMIT_DEV_MAP)) {
        if (commit.subject?.startsWith(prefix)) {
          dev = devName;
          break;
        }
      }
      devLines[dev] = (devLines[dev] ?? 0) + commitAdded;
    }

    return {
      commitCount: commits.length,
      added: totalAdded,
      deleted: totalDeleted,
      changedMenus: Array.from(changedMenuSet),
      devLines,
    };
  } catch (e) {
    console.warn("[biz-digest] git 명령 실패 — git 섹션 생략:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ─── TASK_LOG.md 헬퍼 ────────────────────────────────────────────────────────
interface TaskLogSummary {
  completedYesterday: Array<{ time: string; task: string; dev: string; menu: string }>;
  inProgress: Array<{ task: string; dev: string; progress: string }>;
  userPending: Array<{ icon: string; item: string }>;
  todayQueue: Array<string>;
}

function parseTaskLog(cwd: string): TaskLogSummary | null {
  try {
    const logPath = join(cwd, ".claude", "TASK_LOG.md");
    const content = readFileSync(logPath, "utf8");

    // 처리 완료 (어제) — 간단하게 "✅" 줄 파싱
    const completedYesterday: TaskLogSummary["completedYesterday"] = [];
    const inProgress: TaskLogSummary["inProgress"] = [];
    const userPending: TaskLogSummary["userPending"] = [];
    const todayQueue: string[] = [];

    // 사용자 대기 항목 파싱 (🔐/📋/💾/🌐 이모지로 시작하는 줄)
    const pendingRx = /^[-*]?\s*(🔐|📋|💾|🌐)\s*(.+)$/gm;
    for (const m of content.matchAll(pendingRx)) {
      userPending.push({ icon: m[1], item: m[2].trim() });
    }

    // 처리 중 줄 ("in flight" 또는 "진행 중")
    const inFlightRx = /\|\s*(.+?)\s*\|\s*(Dev\d[^\|]*|PM 메타)\s*\|\s*(\d+%|진행 중|in flight)\s*\|/g;
    for (const m of content.matchAll(inFlightRx)) {
      inProgress.push({
        task: m[1].trim(),
        dev: m[2].trim(),
        progress: m[3].trim(),
      });
    }

    // 다음 24h 큐 파싱
    const queueSection = content.match(/다음 24시간 큐[^\n]*\n([\s\S]*?)(?:\n##|\n---|\n$|$)/);
    if (queueSection?.[1]) {
      for (const line of queueSection[1].split("\n")) {
        const clean = line.replace(/^[-*]\s*/, "").trim();
        if (clean) todayQueue.push(clean);
      }
    }

    return { completedYesterday, inProgress, userPending, todayQueue };
  } catch (e) {
    console.warn("[biz-digest] TASK_LOG.md 읽기 실패 — 해당 섹션 생략:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ─── 4096자 분할 ─────────────────────────────────────────────────────────────
function splitBySection(sections: string[], maxLen = 4096): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const section of sections) {
    const candidate = current ? current + "\n\n" + section : section;
    if (candidate.length > maxLen && current) {
      chunks.push(current.trim());
      current = section;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  // 만약 단일 섹션이 maxLen 초과하면 줄 단위로 다시 분할
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxLen) {
      result.push(chunk);
    } else {
      let start = 0;
      while (start < chunk.length) {
        let end = start + maxLen;
        if (end < chunk.length) {
          const lastNl = chunk.lastIndexOf("\n", end);
          if (lastNl > start) end = lastNl;
        }
        result.push(chunk.slice(start, end).trim());
        start = end;
      }
    }
  }
  return result.filter(Boolean);
}

// ─── 보고서 빌더 ─────────────────────────────────────────────────────────────
async function buildReport(cwd: string): Promise<string[]> {
  const kst = nowKST();
  const dateStr = kstDateString(kst);
  const { start: yStart, end: yEnd } = yesterdayKSTRange();
  const yStartKST = kstDateString(new Date(yStart.getTime() + 9 * 60 * 60 * 1000));

  // 데이터 수집
  const git = tryGit(cwd);
  const taskLog = parseTaskLog(cwd);

  // BizDigestQueue (미발송)
  const pending = await prisma.bizDigestQueue.findMany({
    where: { sentAt: null },
    orderBy: { createdAt: "asc" },
  });

  const decisions = pending.filter((p) => p.type === "decision_needed");
  const blockers  = pending.filter((p) => p.type === "blocker");
  const completed = pending.filter((p) => p.type === "completed");
  const infos     = pending.filter((p) => p.type === "info");

  // AgentActivity (최근 24h)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const activities = await prisma.agentActivity.findMany({
    where: { createdAt: { gte: since24h } },
    orderBy: { createdAt: "desc" },
  });

  const workingAgents = activities.filter((a) => a.status === "working");
  const blockedAgents = activities.filter((a) => a.status === "blocked");

  // ── 섹션 구성 ──────────────────────────────────────────────────────────────
  const sections: string[] = [];

  // [0] 헤더
  sections.push(`🌅 비즈 관리 일일 보고서 — ${dateStr} (KST)`);

  // [1] 어제 진행 요약
  if (git) {
    const menuLine =
      git.changedMenus.length > 0
        ? `메뉴 변경: ${git.changedMenus.join(", ")}`
        : "메뉴 변경: 없음";
    sections.push(
      [
        `📋 어제(${yStartKST} 00:00~23:59 KST) 진행 요약`,
        `- 커밋 ${git.commitCount}건 / 추가 ${git.added}줄 / 삭제 ${git.deleted}줄`,
        `- ${menuLine}`,
      ].join("\n")
    );
  }

  // [2] 처리 완료 (BizDigestQueue type=completed + 어제 완료)
  if (completed.length > 0) {
    const rows = completed.map((c) => {
      const t = new Date(c.createdAt.getTime() + 9 * 60 * 60 * 1000);
      const hhmm = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
      return `| ${hhmm} | ${c.title} | ${c.category} | — |`;
    });
    sections.push(
      [
        "✅ 처리 완료 (어제)",
        "| 시각 | 작업 | 담당 Dev | 메뉴 |",
        "|------|------|---------|------|",
        ...rows,
      ].join("\n")
    );
  }

  // [3] 처리 중 (AgentActivity working)
  if (workingAgents.length > 0 || (taskLog?.inProgress && taskLog.inProgress.length > 0)) {
    const lines: string[] = [
      "🔄 처리 중 (현재)",
      "| 작업 | 담당 | 진행도 |",
      "|------|------|--------|",
    ];
    // AgentActivity working 우선
    const seen = new Set<string>();
    for (const a of workingAgents) {
      if (seen.has(a.agentName)) continue;
      seen.add(a.agentName);
      lines.push(`| ${a.currentTask ?? a.agentName} | ${a.agentName} | 작업중 |`);
    }
    // TASK_LOG inProgress 보완
    if (taskLog?.inProgress) {
      for (const ip of taskLog.inProgress) {
        lines.push(`| ${ip.task} | ${ip.dev} | ${ip.progress} |`);
      }
    }
    sections.push(lines.join("\n"));
  }

  // [4] 기여도 그래프
  if (git && Object.keys(git.devLines).length > 0) {
    const totalLines = Object.values(git.devLines).reduce((s, v) => s + v, 0);
    const maxLines = Math.max(...Object.values(git.devLines), 1);
    const lines: string[] = ["📊 어제 기여도 (라인 기준)"];
    // ALL_DEVS 순서로 표시, 그 외는 뒤에 추가
    const ordered = [
      ...ALL_DEVS,
      ...Object.keys(git.devLines).filter((d) => !ALL_DEVS.includes(d)),
    ];
    for (const dev of ordered) {
      const devLineCount = git.devLines[dev] ?? 0;
      const pct = totalLines > 0 ? Math.round((devLineCount / totalLines) * 100) : 0;
      const bar = devLineCount > 0 ? buildBar(devLineCount, maxLines) : "";
      const padded = dev.padEnd(12, " ");
      lines.push(`${padded} ${bar} ${devLineCount} (${pct}%)`);
    }
    sections.push(lines.join("\n"));
  }

  // [5] 사용자 처리 대기
  const iconGroups: Record<string, string[]> = { "🔐": [], "📋": [], "💾": [], "🌐": [] };
  if (taskLog?.userPending) {
    for (const { icon, item } of taskLog.userPending) {
      if (iconGroups[icon]) iconGroups[icon].push(item);
    }
  }
  // BizDigestQueue info 항목도 포함
  for (const info of infos) {
    iconGroups["📋"].push(info.title);
  }

  const totalPending =
    iconGroups["🔐"].length +
    iconGroups["📋"].length +
    iconGroups["💾"].length +
    iconGroups["🌐"].length;

  if (totalPending > 0) {
    const lines: string[] = [
      `🌙 사용자님 처리 대기 항목`,
      `🔐 ${iconGroups["🔐"].length}건 / 📋 ${iconGroups["📋"].length}건 / 💾 ${iconGroups["💾"].length}건 / 🌐 ${iconGroups["🌐"].length}건`,
    ];
    for (const [icon, items] of Object.entries(iconGroups)) {
      for (const item of items) {
        lines.push(`- ${icon} ${item}`);
      }
    }
    sections.push(lines.join("\n"));
  }

  // [6] 결정 필요
  if (decisions.length > 0) {
    const lines: string[] = ["🚧 결정 필요"];
    decisions.forEach((d, i) => {
      const num = i + 1;
      const opts = Array.isArray(d.decisionOptions)
        ? (d.decisionOptions as Array<{ id: string; label: string }>)
        : [];
      if (opts.length > 0) {
        const optsLabel = opts.map((o) => o.label).join(" vs ");
        const first = opts[0]?.label ?? "";
        lines.push(`${num}. ${d.title} — ${optsLabel} (메인 추천: ${first})`);
        const replyOpts = opts.map((o, oi) => `"${num}: ${o.label}"`).join(" 또는 ");
        lines.push(`   답변: ${replyOpts}`);
      } else {
        lines.push(`${num}. ${d.title}`);
        if (d.body && d.body !== d.title) lines.push(`   ${d.body.split("\n")[0]}`);
      }
    });
    sections.push(lines.join("\n"));
  }

  // [7] 블로커 (있을 때만)
  if (blockers.length > 0 || blockedAgents.length > 0) {
    const lines: string[] = ["🚫 블로커"];
    for (const b of blockers) {
      lines.push(`- ${b.title}`);
      if (b.body && b.body !== b.title) lines.push(`  ${b.body.split("\n")[0]}`);
    }
    const seenAgents = new Set<string>();
    for (const a of blockedAgents) {
      if (seenAgents.has(a.agentName)) continue;
      seenAgents.add(a.agentName);
      lines.push(`- [${a.agentName}] ${a.notes ?? a.currentTask ?? "블로킹 상태"}`);
    }
    sections.push(lines.join("\n"));
  }

  // [8] 오늘 24h 큐
  if (taskLog?.todayQueue && taskLog.todayQueue.length > 0) {
    const lines = ["📅 오늘 24h 큐", ...taskLog.todayQueue.map((q) => `- ${q}`)];
    sections.push(lines.join("\n"));
  }

  // [9] 푸터 링크
  const siteUrl = process.env.NEXTAUTH_URL ?? "";
  const footerParts: string[] = [];
  if (siteUrl) footerParts.push(`사이트: ${siteUrl}`);
  footerParts.push("깃: main 브랜치");
  if (footerParts.length > 0) {
    sections.push(`링크: ${footerParts.join(" / ")}`);
  }

  return splitBySection(sections);
}

// ─── 발송 유틸 ────────────────────────────────────────────────────────────────
async function sendChunks(chunks: string[]): Promise<boolean> {
  for (const chunk of chunks) {
    let result = await sendTelegramMessage(chunk);
    if (!result.ok) {
      result = await sendTelegramMessage(chunk);
      if (!result.ok) {
        console.error("[biz-digest] 텔레그램 발송 실패:", result.error ?? result);
        return false;
      }
    }
  }
  return true;
}

// ─── GET /api/cron/biz-digest ─────────────────────────────────────────────────
// Vercel cron (UTC 0:00 = KST 9:00) 또는 CRON_SECRET으로 수동 호출
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.warn("[biz-digest] CRON_SECRET 미설정 — 인증 불가");
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 });
  }

  const authHeader = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");

  if (authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID_BIZ;
  if (!token || !chatId) {
    console.warn("[biz-digest] TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID_BIZ 미설정 — 발송 건너뜀");
    return NextResponse.json({ ok: true, skipped: true, reason: "TELEGRAM_ENV_MISSING" });
  }

  const cwd = process.cwd();
  const chunks = await buildReport(cwd);

  const sent = await sendChunks(chunks);
  if (!sent) {
    return NextResponse.json({ ok: false, error: "텔레그램 발송 실패" }, { status: 502 });
  }

  // 발송된 BizDigestQueue 항목 sentAt 업데이트
  const pendingIds = (
    await prisma.bizDigestQueue.findMany({
      where: { sentAt: null },
      select: { id: true },
    })
  ).map((p) => p.id);

  if (pendingIds.length > 0) {
    await prisma.bizDigestQueue.updateMany({
      where: { id: { in: pendingIds } },
      data: { sentAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true, chunks: chunks.length });
}

// ─── POST /api/cron/biz-digest — 수동 트리거 (BIZ/ADMIN 세션 또는 CRON_SECRET) ──
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    const { getServerSession } = await import("next-auth");
    const { authOptions } = await import("@/lib/auth");
    const session = await getServerSession(authOptions);
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (!session || (role !== "BIZ" && role !== "ADMIN")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID_BIZ;
  if (!token || !chatId) {
    console.warn("[biz-digest] TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID_BIZ 미설정");
    return NextResponse.json({ ok: false, reason: "TELEGRAM_ENV_MISSING" }, { status: 503 });
  }

  const cwd = process.cwd();
  const chunks = await buildReport(cwd);

  const sent = await sendChunks(chunks);
  if (!sent) {
    return NextResponse.json({ ok: false, error: "텔레그램 발송 실패" }, { status: 502 });
  }

  // 수동 트리거 시 sentAt 업데이트 (멱등 처리)
  const pendingIds = (
    await prisma.bizDigestQueue.findMany({
      where: { sentAt: null },
      select: { id: true },
    })
  ).map((p) => p.id);

  if (pendingIds.length > 0) {
    await prisma.bizDigestQueue.updateMany({
      where: { id: { in: pendingIds } },
      data: { sentAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true, chunks: chunks.length, manual: true });
}
