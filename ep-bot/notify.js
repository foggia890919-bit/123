// 알림 모듈: 텔레그램 + 카카오톡(나에게보내기). 설정된 채널로만 발송, 없으면 콘솔만.
//   텔레그램: simple/.env 의 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (로컬에 있음)
//   카카오:   KAKAO_REST_API_KEY / KAKAO_CLIENT_SECRET / refresh(simple/.kakao_refresh 또는 env) (Lightsail에 있음)
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "simple", ".env") });
let cfg = {};
try { cfg = require("./notify.json"); } catch {}

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || cfg.telegram_bot_token;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || cfg.telegram_chat_id;
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY || cfg.kakao_rest_api_key;
const KAKAO_SECRET = process.env.KAKAO_CLIENT_SECRET || cfg.kakao_client_secret;
const KAKAO_REFRESH_FILE = path.join(__dirname, "..", "simple", ".kakao_refresh");

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return false;
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text }),
  });
  return res.ok;
}

function getKakaoRefresh() {
  try { if (fs.existsSync(KAKAO_REFRESH_FILE)) return fs.readFileSync(KAKAO_REFRESH_FILE, "utf8").trim(); } catch {}
  return process.env.KAKAO_REFRESH_TOKEN || cfg.kakao_refresh_token;
}
async function getKakaoToken() {
  if (!KAKAO_KEY) return null;
  const refresh = getKakaoRefresh();
  if (!refresh) return null;
  const body = new URLSearchParams({ grant_type: "refresh_token", client_id: KAKAO_KEY, refresh_token: refresh });
  if (KAKAO_SECRET) body.set("client_secret", KAKAO_SECRET);
  const res = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.refresh_token) { try { fs.writeFileSync(KAKAO_REFRESH_FILE, data.refresh_token, "utf8"); } catch {} }
  return data.access_token || null;
}
async function sendKakao(text) {
  const token = await getKakaoToken();
  if (!token) return false;
  const tmpl = { object_type: "text", text, link: { web_url: "https://yk.ep45.co.kr", mobile_web_url: "https://yk.ep45.co.kr" } };
  const res = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({ template_object: JSON.stringify(tmpl) }),
  });
  return res.ok;
}

async function notify(text) {
  console.log("\n[알림 발송]\n" + text);
  const ch = [];
  if (await sendTelegram(text).catch(() => false)) ch.push("텔레그램");
  if (await sendKakao(text).catch(() => false)) ch.push("카카오톡");
  console.log(ch.length ? `  → 발송 완료: ${ch.join(", ")}` : "  → (채널 미설정 — 콘솔에만 표시)");
  return ch;
}

module.exports = { notify, sendTelegram, sendKakao };
