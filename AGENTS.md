<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:change-workflow -->
# Change Workflow — Mandatory for ALL code modifications

**Never make code changes without completing the steps below first.**

## Step 1 — Plan (required for every change)

Before touching any file, spawn a `Plan` sub-agent with:
- The exact problem statement
- All files likely affected (read them first)
- Constraints: which tables/columns exist, which API contracts must hold
- Definition of done: what must still work after the change

The Plan agent returns a step-by-step implementation plan identifying critical files and risks.

## Step 2 — Cross-validate (required if plan touches ≥ 2 files OR any shared utility)

Spawn a `biz-qa-crosscheck` agent with:
- The Plan agent's output
- The actual file contents it references
- Ask: "Does this plan introduce regressions? Are there edge cases the plan misses?"

The QA agent must return explicit PASS or FAIL + reasons before any code is written.

## Step 3 — Implement (only after Step 1 + 2 are complete)

Follow the verified plan exactly. Do not deviate mid-implementation.
After each file edit, mentally re-check: "Does anything that previously called this still work?"

## Step 4 — Verify build (required after every push)

Run `npx tsc --noEmit` to confirm no TypeScript errors were introduced.
If errors appear, fix them before reporting the task as done.

## Regression checklist (run mentally before every commit)

- [ ] All callers of modified functions still compile
- [ ] No column names referenced that don't exist in the DB schema
- [ ] No imports added that require new env vars not already documented
- [ ] `updatedAt` only referenced on tables that have it (FilterRequest ✓, Client ✓, MemberCompanyRate ✓, CorpCompanyRate ✓ — UserClient ✗, SubmissionRoute ✗)
- [ ] `normalizeCompanyName` applied at every write point, not just some

## DB schema facts (source of truth — do not contradict)

| Table | Has updatedAt | Unique constraints |
|-------|--------------|-------------------|
| User | ✓ | email |
| UserClient | ✗ | (userId, bizNumber) |
| Client | ✓ | clientName |
| FilterRequest | ✓ | — |
| SubmissionRoute | ✗ | (clientName, companyName) |
| MemberCompanyRate | ✓ | (userId, companyName) |
| CorpCompanyRate | ✓ | (corpName, companyName) |
<!-- END:change-workflow -->
