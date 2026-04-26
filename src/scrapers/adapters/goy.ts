import { makeGenericAdapter } from "./_base";

// PLACEHOLDER. Run `npm run scrape:inspect goy <code>` once.
// Hosted on geoweb.kr — likely a hosted-platform CMS with standard
// member login. Search route may live under /Order or /Product.
export const goy = makeGenericAdapter({
  key: "goy",
  name: "고양약품",
  baseUrl: "https://goy.geoweb.kr",
  loginUrl: "https://goy.geoweb.kr/Member/Login",
});
