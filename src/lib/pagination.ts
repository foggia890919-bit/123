import { safeParseInt } from "@/lib/auth-guard";

/**
 * Extract page / limit / skip from URLSearchParams with safe clamping.
 *
 * Every value is run through `safeParseInt` so non-numeric or out-of-range
 * inputs are silently replaced by the defaults.
 */
export function paginationParams(
  searchParams: URLSearchParams,
  { defaultLimit = 20, maxLimit = 100, maxPage = 10000 }: { defaultLimit?: number; maxLimit?: number; maxPage?: number } = {},
) {
  const page = safeParseInt(searchParams.get("page"), 1, 1, maxPage);
  const limit = safeParseInt(searchParams.get("limit"), defaultLimit, 1, maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}
