-- Kiara Chat: who last edited a driver order, so /orders can say
-- "عُدّل بواسطة <الموظفة> · قبل ساعة" instead of only when it was created.
-- Purely additive and tenant-agnostic: a nullable column other apps ignore.
-- `updated_at` already exists on the table; only the author was missing.
alter table public.driver_orders
  add column if not exists updated_by uuid references public.team_members(id);
