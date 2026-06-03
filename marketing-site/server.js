/*
 * 독립형 회사 홈페이지 서버 — 외부 의존성 없음(Node 내장 모듈만).
 *  - GET  /            공개 홈페이지 (콘텐츠 JSON을 서버에서 HTML로 렌더링)
 *  - GET  /admin       관리자 페이지 (로그인 후 섹션 추가/삭제/순서변경/수정)
 *  - GET  /api/content 현재 콘텐츠 반환
 *  - POST /api/content 콘텐츠 저장 (관리자만)
 *  - POST /api/login   비밀번호 로그인 → 세션 쿠키
 *  - POST /api/logout  로그아웃
 *  - POST /api/upload  이미지 업로드(base64) → /uploads/* (관리자만)
 *
 * 실행:  ADMIN_PASSWORD=원하는비번 PORT=3000 node server.js
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const SiteRender = require("./render.js");

const ROOT = __dirname;
const CONTENT_FILE = path.join(ROOT, "content", "site.json");
const UPLOAD_DIR = path.join(ROOT, "data", "uploads");
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const SECRET = crypto.createHash("sha256").update("session::" + ADMIN_PASSWORD).digest();

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------- 콘텐츠 입출력 ---------------- */
function loadContent() {
  try {
    return JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8"));
  } catch (e) {
    return { settings: {}, sections: [] };
  }
}
function saveContent(data) {
  fs.writeFileSync(CONTENT_FILE, JSON.stringify(data, null, 2), "utf8");
}

/* ---------------- 인증 ---------------- */
function makeToken() {
  return crypto.createHmac("sha256", SECRET).update("authenticated").digest("hex");
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  raw.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) {
  const c = parseCookies(req);
  if (!c.sess) return false;
  const expected = makeToken();
  const a = Buffer.from(c.sess);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- HTTP 유틸 ---------------- */
function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ "Cache-Control": "no-store" }, headers || {}));
  res.end(body);
}
function sendJson(res, status, obj, headers) {
  send(res, status, JSON.stringify(obj), Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers || {}));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > (limit || 1e6)) { reject(new Error("payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".ico": "image/x-icon", ".json": "application/json; charset=utf-8"
};
function serveFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, "Not found");
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

/* ---------------- 공개 페이지 렌더 ---------------- */
function renderPage(content) {
  const s = content.settings || {};
  const primary = s.primaryColor || "#0b5cab";
  const accent = s.accentColor || "#16b8a6";
  const body = SiteRender.renderSections(content);
  const e = SiteRender.esc;
  const nav =
    '<header class="site-header"><div class="container site-header__inner">' +
    '<a class="brand" href="#top"><span class="brand__mark">' + e(s.logoText || "LOGO") + "</span></a>" +
    '<nav class="nav"><a href="#about">회사소개</a><a href="#contact">문의</a>' +
    (s.phone ? '<a class="nav__phone" href="tel:' + e(s.phone) + '">' + e(s.phone) + "</a>" : "") +
    "</nav></div></header>";
  const footer =
    '<footer class="site-footer"><div class="container">' +
    (s.footerCompany ? '<p class="site-footer__company">' + e(s.footerCompany) + "</p>" : "") +
    (s.footerAddress ? "<p>" + e(s.footerAddress) + "</p>" : "") +
    (s.footerText ? '<p class="site-footer__copy">' + e(s.footerText) + "</p>" : "") +
    "</div></footer>";
  return (
    "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\">" +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>" + e(s.siteName || "회사 홈페이지") + "</title>" +
    '<link rel="stylesheet" href="/public/styles.css">' +
    "<style>:root{--primary:" + e(primary) + ";--accent:" + e(accent) + ";}</style>" +
    '</head><body id="top">' + nav + "<main>" + body + "</main>" + footer +
    "</body></html>"
  );
}

/* ---------------- 라우팅 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);

  try {
    // 정적 파일
    if (pathname === "/render.js") return serveFile(res, path.join(ROOT, "render.js"));
    if (pathname.startsWith("/public/")) {
      const fp = path.join(ROOT, "public", pathname.slice("/public/".length));
      if (!fp.startsWith(path.join(ROOT, "public"))) return send(res, 403, "forbidden");
      return serveFile(res, fp);
    }
    if (pathname.startsWith("/uploads/")) {
      const fp = path.join(UPLOAD_DIR, path.basename(pathname));
      return serveFile(res, fp);
    }

    // API
    if (pathname === "/api/content" && req.method === "GET") {
      return sendJson(res, 200, loadContent());
    }
    if (pathname === "/api/content" && req.method === "POST") {
      if (!isAuthed(req)) return sendJson(res, 401, { error: "unauthorized" });
      const raw = await readBody(req, 5e6);
      let data;
      try { data = JSON.parse(raw); } catch (e) { return sendJson(res, 400, { error: "invalid json" }); }
      if (!data || !Array.isArray(data.sections)) return sendJson(res, 400, { error: "bad shape" });
      saveContent(data);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === "/api/login" && req.method === "POST") {
      const raw = await readBody(req, 1e4);
      let pw = "";
      try { pw = (JSON.parse(raw) || {}).password || ""; } catch (e) {}
      if (pw !== ADMIN_PASSWORD) return sendJson(res, 401, { error: "비밀번호가 올바르지 않습니다." });
      return sendJson(res, 200, { ok: true }, {
        "Set-Cookie": "sess=" + makeToken() + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400"
      });
    }
    if (pathname === "/api/logout" && req.method === "POST") {
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": "sess=; HttpOnly; Path=/; Max-Age=0" });
    }
    if (pathname === "/api/me" && req.method === "GET") {
      return sendJson(res, 200, { authed: isAuthed(req) });
    }
    if (pathname === "/api/upload" && req.method === "POST") {
      if (!isAuthed(req)) return sendJson(res, 401, { error: "unauthorized" });
      const raw = await readBody(req, 12e6);
      let body;
      try { body = JSON.parse(raw); } catch (e) { return sendJson(res, 400, { error: "invalid json" }); }
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(body.dataUrl || "");
      if (!m) return sendJson(res, 400, { error: "이미지 파일만 업로드할 수 있습니다." });
      const extMap = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg" };
      const ext = extMap[m[1]] || ".png";
      const name = crypto.randomBytes(8).toString("hex") + ext;
      fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[2], "base64"));
      return sendJson(res, 200, { url: "/uploads/" + name });
    }

    // 페이지
    if (pathname === "/admin" || pathname === "/admin/") {
      return serveFile(res, path.join(ROOT, "public", "admin.html"));
    }
    if (pathname === "/") {
      const html = renderPage(loadContent());
      return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
    }

    return send(res, 404, "Not found");
  } catch (e) {
    return sendJson(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log("▶ 사이트:    http://localhost:" + PORT + "/");
  console.log("▶ 관리자:    http://localhost:" + PORT + "/admin   (비밀번호: " + ADMIN_PASSWORD + ")");
});
