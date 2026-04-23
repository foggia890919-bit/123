-- ============================================================================
-- ADMIN PROMOTION — run in Supabase SQL editor ONCE.
-- Replace YOUR_EMAIL@example.com with the email you want to make admin.
-- That account must already exist (register via the app normally first).
-- ============================================================================

UPDATE "User"
SET role = 'ADMIN',
    approved = true,
    "updatedAt" = NOW()
WHERE email = 'YOUR_EMAIL@example.com';

-- Verify:
SELECT id, email, name, role, approved FROM "User" WHERE email = 'YOUR_EMAIL@example.com';
