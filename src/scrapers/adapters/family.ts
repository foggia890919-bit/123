import { makeGenericAdapter } from "./_base";

// PLACEHOLDER. Run `npm run scrape:inspect family <code>` once.
// Note: site is HTTP only (no HTTPS) — login credentials travel in
// plaintext, which is concerning. Flag to the operator.
export const family = makeGenericAdapter({
  key: "family",
  name: "패밀리약품",
  baseUrl: "http://family-pharm.co.kr",
  loginUrl: "http://family-pharm.co.kr/member/",
});
