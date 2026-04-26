import { makeGenericAdapter } from "./_base";

// PLACEHOLDER. Run `npm run scrape:inspect picomall <code>` once.
// `.do` URL extension suggests Spring backend; form action and field
// names should be standard but confirm with inspect.
export const picomall = makeGenericAdapter({
  key: "picomall",
  name: "피코몰",
  baseUrl: "https://wsale.picomall.co.kr",
  loginUrl: "https://wsale.picomall.co.kr/member/login.do",
});
