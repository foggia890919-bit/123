// Supabase 주문 → EP 발주 봇. 기본: status='EP발주대기'(관리자 확정분) 처리.
//   resolveOrder(매핑/보험코드)로 EP상품 확정 → EP 표시명으로 검색·발주. 추가실패는 알림.
//   ★ 담기까지만(LIVE_ORDER=1 이면 실제 발주). 실제발주(placed) 시에만 status 갱신.
// 실행: node ep-bot/run_from_db.js [주문UUID]   (UUID 생략 시 status 기준 1건)
const { processOrder } = require("./bot");
const { notify } = require("./notify");
const { makePool, ensureMapTable, resolveOrder } = require("./match");

const dbCfg = require("./db.json");
const { Pool } = require("pg");
const orderId = process.argv[2];
const STATUS = process.env.ORDER_STATUS || "EP발주대기";
const epDigits = (b) => String(b || "").replace(/[^0-9]/g, "");
// 강제 발주용 넓은 검색어: 앞쪽 [..]/퇴장] 제거 후 첫 '(' '[' '_' '숫자' 앞까지(=브랜드 stem, 용량·% 제거)
const broadStem = (n) => String(n || "").replace(/^\s*퇴장\]\s*/, "").replace(/^\[[^\]]*\]\s*/, "").split(/[([_\d]/)[0].trim();

(async () => {
  const pool = makePool();
  await ensureMapTable(pool);
  // 대상 주문: 인자 UUID 우선, 없으면 발주 큐(ep_order_queue, status='대기')에서 1건
  let targetId = orderId;
  if (!targetId) {
    const q = await pool.query("SELECT order_id FROM ep_order_queue WHERE status='대기' ORDER BY requested_at LIMIT 1");
    if (!q.rows.length) { console.log("발주 대기 큐 없음 (ep_order_queue status='대기')."); await pool.end(); return; }
    targetId = q.rows[0].order_id;
  }
  const sql = "SELECT o.id,o.status,o.order_date,c.name cust,c.biz_no FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=$1";
  const ord = await pool.query(sql, [targetId]);
  if (!ord.rows.length) { console.log("주문을 찾을 수 없음:", targetId); await pool.end(); return; }
  const o = ord.rows[0];
  const resolved = await resolveOrder(pool, o.id);
  await pool.end();

  const epId = epDigits(o.biz_no);
  const matched = resolved.filter((r) => r.ep);
  const failed = resolved.filter((r) => !r.ep);

  console.log("===== 주문", String(o.id).slice(0, 8), "|", o.cust, "(", o.status, ") =====");
  console.log("EP아이디", epId, "/ 7777");
  resolved.forEach((r) => console.log(`  ${r.ep ? "✓" : "✗"} ${r.yk.name} x${r.qty} [${r.source}]${r.ep ? " → " + r.ep.print_name : ""}`));
  console.log("");
  if (!epId) { console.log("⚠ 사업자번호 없음 → EP 로그인 불가"); return; }

  // EP 표시명으로 검색, 보험코드로 매칭 (없으면 규격)
  const order = { login: { id: epId, pw: "7777" }, items: matched.map((r) => ({
    name: r.ep.print_name, code: (r.ep.insurance_code || "").trim(), size: r.ep.spec, qty: r.qty,
    searchTerm: r.ep.force ? broadStem(r.yk.name) : undefined, // 강제: 브랜드명으로 EP 실시간 검색
  })) };

  let res = { reconcile: [], allOk: failed.length === 0, placed: false };
  if (order.items.length) {
    res = await processOrder(order, { live: process.env.LIVE_ORDER === "1", clearCart: process.env.CLEAR_CART === "1" });
  } else {
    console.log("매칭된 품목이 없어 봇 실행 생략.");
  }

  // 결과 요약 → 카톡/텔레그램 항상 발송 (정갈하게 섹션 구분, 이모지 없이 — PC카톡 깨짐 방지)
  const clean = (v) => String(v || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const okItems = (res.reconcile || []).filter((x) => x.ok);
  const problems = [
    ...(res.reconcile || []).filter((x) => !x.ok),
    ...failed.map((f) => ({ name: f.yk.name, intendedQty: f.qty, placedQty: null, status: "미취급/매핑필요" })),
  ];
  const totalItems = resolved.length;
  const L = [];
  L.push(`[EP 발주 결과] ${res.placed ? "발주완료" : "테스트(담기까지)"}`);
  L.push("─────────────────");
  L.push(`거래처   : ${o.cust}`);
  L.push(`주문일   : ${String(o.order_date).slice(0, 10)}`);
  L.push(`주문번호 : ${String(o.id).slice(0, 8)}`);
  L.push("");
  L.push(`총 ${totalItems}건  /  ${res.placed ? "발주" : "담김"} ${okItems.length}건  /  확인필요 ${problems.length}건`);
  if (okItems.length) {
    L.push("");
    L.push(`■ ${res.placed ? "발주 완료" : "담기 완료"}`);
    okItems.forEach((x, i) => { if (i) L.push(""); L.push(` - ${clean(x.name)}  (수량 ${x.intendedQty})`); });
  }
  if (problems.length) {
    L.push("");
    L.push("■ 확인 필요");
    problems.forEach((p, i) => { if (i) L.push(""); L.push(` - ${clean(p.name)}\n   주문 ${p.intendedQty} / 담김 ${p.placedQty ?? "없음"} · ${p.status}`); });
  }
  await notify(L.join("\n"));

  // 실제 발주(LIVE)했을 때만 상태/큐 갱신
  if (res.placed) {
    const ok = problems.length === 0;
    const p2 = new Pool({ ...dbCfg, max: 1, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 12000 });
    await p2.query("UPDATE orders SET status=$1 WHERE id=$2", [ok ? "EP완료" : "EP확인필요", o.id]);
    await p2.query("UPDATE ep_order_queue SET status=$1, processed_at=now(), result=$2 WHERE order_id=$3",
      [ok ? "완료" : "확인필요", ok ? "전부 발주" : "일부 미매칭/누락", o.id]);
    await p2.end();
    console.log(`\n주문 상태 → '${ok ? "EP완료" : "EP확인필요"}' / 큐 마감.`);
  } else {
    console.log("\n(테스트: 실제 발주 안 함 → status·큐 변경 안 함.)");
  }
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
