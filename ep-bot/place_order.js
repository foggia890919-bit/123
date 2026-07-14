// 파일(JSON) 기반 발주 테스트. 핵심 로직은 bot.js.
// 실행: node ep-bot/place_order.js [주문서.json]    (LIVE_ORDER=1 이면 실제 발주)
const fs = require("fs");
const path = require("path");
const { processOrder } = require("./bot");

const orderFile = process.argv[2] || path.join(__dirname, "test_order.json");
const order = JSON.parse(fs.readFileSync(orderFile, "utf8"));

processOrder(order, {
  live: process.env.LIVE_ORDER === "1",
  clearCart: process.env.CLEAR_CART === "1",
})
  .then(() => {
    console.log("결과: dumps/order_result.json, place_order.png / 브라우저 직접 닫으세요.");
  })
  .catch((e) => { console.error("FATAL:", e); process.exit(1); });
