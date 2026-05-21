// 사용자가 보낸 URL 을 서버에서 fetch 해주는 엔드포인트(이미지 다운로드 등) 가
// 내부망/클라우드 메타데이터를 못 찌르도록 막는 SSRF 가드.
// IP 리터럴은 직접 차단, 호스트명은 일단 통과시키되 DNS rebinding 까지 막으려면
// fetch 후 응답 IP 도 검사가 필요하지만 1차로는 IP 리터럴/localhost 만 차단.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
]);

function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 127) return true;                      // 127.0.0.0/8 loopback
  if (a === 0) return true;                        // 0.0.0.0/8
  if (a === 169 && b === 254) return true;         // 169.254.0.0/16 link-local + AWS/GCP 메타데이터
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16
  if (a >= 224) return true;                       // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;   // unique local
  if (lower.startsWith("fe80:")) return true;                          // link-local
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice("::ffff:".length);
    return isPrivateIPv4(v4);
  }
  return false;
}

export function assertSafePublicUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("올바른 URL 이 아닙니다");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`허용되지 않은 프로토콜: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`내부 호스트는 차단됩니다: ${host}`);
  }
  if (host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error(`내부 도메인은 차단됩니다: ${host}`);
  }
  // IP 리터럴 직접 차단
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateIPv4(host)) {
    throw new Error(`사설 IP 는 차단됩니다: ${host}`);
  }
  if (host.includes(":") && isPrivateIPv6(host)) {
    throw new Error(`사설 IPv6 는 차단됩니다: ${host}`);
  }
  return url;
}
