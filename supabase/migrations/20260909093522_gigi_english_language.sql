-- Gigi is Filipino and reads English. Add English as an explicit language
-- override so her dispatch messages and field app do not follow the incorrect
-- Indonesian nationality previously stored on her roster row.
alter table public.specialists
  drop constraint if exists specialists_preferred_language_check;

alter table public.specialists
  add constraint specialists_preferred_language_check
  check (
    preferred_language is null
    or preferred_language in ('ar', 'en', 'id', 'fil', 'ru', 'am')
  );

-- Target the immutable UUID so similarly named specialists are not changed.
update public.specialists
set nationality = 'ph', preferred_language = 'en', updated_at = now()
where id = '44600482-2d4b-4026-bc33-c6730de7a8b0';
