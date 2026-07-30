-- Kiara Chat: specialist nationality — drives the translated order copy the
-- specialist receives on WhatsApp (see src/lib/nationalities.ts for the codes).
-- Purely additive and tenant-agnostic: a nullable column other apps ignore.
alter table public.specialists
  add column if not exists nationality text;
