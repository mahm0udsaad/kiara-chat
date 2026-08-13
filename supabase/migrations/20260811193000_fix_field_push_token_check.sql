-- Repairs `field_staff_push_tokens_expo_check` on a database where the field
-- staff migration has ALREADY been applied.
--
-- The original constraint was written with doubled backslashes:
--
--   expo_token ~ '^ExponentPushToken\\[[^]]+\\]$|^ExpoPushToken\\[[^]]+\\]$'
--
-- With `standard_conforming_strings = on` (the default, and what the hosted
-- project runs) a backslash inside a plain literal is already literal, so that
-- pattern demands a backslash before the bracket. Real tokens look like
-- `ExponentPushToken[xxxxxxxx]` and never match, so every device registration
-- fails the check. Verified against production, which reports
-- `'ExponentPushToken[abc123XYZ]' ~ <the shipped pattern>` as false and holds
-- zero rows in the table.
--
-- 20260811113000 now carries the corrected pattern for a from-zero apply; this
-- migration is what fixes an environment where the table already exists, since
-- `create table if not exists` will not revisit a constraint.

alter table public.field_staff_push_tokens
  drop constraint if exists field_staff_push_tokens_expo_check;

alter table public.field_staff_push_tokens
  add constraint field_staff_push_tokens_expo_check
  check (expo_token ~ '^ExponentPushToken\[[^]]+\]$|^ExpoPushToken\[[^]]+\]$');

-- Verification after applying:
-- select 'ExponentPushToken[abc123XYZ]' ~ (
--   select regexp_replace(pg_get_constraintdef(oid),
--     '^CHECK \(\(expo_token ~ ''(.*)''::text\)\)$', '\1')
--   from pg_constraint
--   where conname = 'field_staff_push_tokens_expo_check'
-- ) as accepts_a_real_token;
