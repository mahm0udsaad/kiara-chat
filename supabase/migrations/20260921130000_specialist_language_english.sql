-- English was missing from the languages a specialist may be given.
--
-- The app has offered الإنجليزية in the roster's language picker since the
-- column was added, and `SPECIALIST_LANGUAGE_CODES` has always included "en",
-- but the check constraint was written without it. Choosing English for a
-- specialist therefore failed with a constraint violation, and the one
-- specialist who needs it — لاجيجي, who reads English rather than Filipino —
-- has been served by a hardcoded UUID override in the application instead.
--
-- Adding the value both unblocks the picker and lets that override retire.
alter table public.specialists
  drop constraint if exists specialists_preferred_language_check;

alter table public.specialists
  add constraint specialists_preferred_language_check
  check (
    preferred_language is null
    or preferred_language in ('ar', 'en', 'id', 'fil', 'ru', 'am')
  );

-- Persist the choice the application was making in code. Targeted by immutable
-- UUID so a replay in another tenant cannot touch a similarly named person.
update public.specialists
set preferred_language = 'en', updated_at = now()
where id = '44600482-2d4b-4026-bc33-c6730de7a8b0'
  and preferred_language is null;
