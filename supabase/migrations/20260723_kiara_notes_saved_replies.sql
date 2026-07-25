-- Kiara Chat: internal notes + saved replies.
-- Additive, tenant-scoped, RLS via the existing is_restaurant_member helper.
-- Does not touch any table the parent (Nehgz) app uses.

-- Staff-only internal notes on a conversation (never sent to the customer).
create table if not exists public.conversation_internal_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  author_user_id uuid references auth.users(id),
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_cin_conversation
  on public.conversation_internal_notes(conversation_id, created_at);

alter table public.conversation_internal_notes enable row level security;

drop policy if exists cin_select on public.conversation_internal_notes;
create policy cin_select on public.conversation_internal_notes
  for select using (is_restaurant_member(restaurant_id, auth.uid()));

drop policy if exists cin_insert on public.conversation_internal_notes;
create policy cin_insert on public.conversation_internal_notes
  for insert with check (is_restaurant_member(restaurant_id, auth.uid()));

-- Reusable canned replies (per tenant).
create table if not exists public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  body text not null check (char_length(trim(body)) > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_saved_replies_restaurant
  on public.saved_replies(restaurant_id);

alter table public.saved_replies enable row level security;

drop policy if exists saved_replies_select on public.saved_replies;
create policy saved_replies_select on public.saved_replies
  for select using (is_restaurant_member(restaurant_id, auth.uid()));

drop policy if exists saved_replies_all on public.saved_replies;
create policy saved_replies_all on public.saved_replies
  for all using (is_restaurant_member(restaurant_id, auth.uid()))
  with check (is_restaurant_member(restaurant_id, auth.uid()));
