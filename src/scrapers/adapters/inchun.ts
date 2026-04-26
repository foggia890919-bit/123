import { makeGenericAdapter } from "./_base";

// PLACEHOLDER. Run `npm run scrape:inspect inchun <code>` once and share
// page-inputs.json + 02-after-login.url.txt to lock down selectors.
// Site is an ASP-classic app, login URL likely differs from intro.asp.
export const inchun = makeGenericAdapter({
  key: "inchun",
  name: "인천약품",
  baseUrl: "https://inchunpharm.com",
  loginUrl: "https://inchunpharm.com/homepage/intro.asp",
});
