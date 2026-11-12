-- ============================================================================
-- Unico: real reviews + automatic clean-up of old bookings.
-- Supabase → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once.
-- ============================================================================

-- ---------- Reviews (copied in by the owner from Google) ---------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  author text not null,
  rating int not null default 5 check (rating between 1 and 5),
  text text not null,
  sort_order int default 0,
  active boolean default true,
  created_at timestamptz default now()
);
alter table public.reviews enable row level security;
drop policy if exists "anyone can read" on public.reviews;
drop policy if exists "owner can change" on public.reviews;
create policy "anyone can read" on public.reviews for select using (true);
create policy "owner can change" on public.reviews for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select on public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;
grant all on public.reviews to service_role;

-- Link to the shop's Google reviews (set it in the admin under Shop details).
alter table public.shop_settings add column if not exists google_reviews_url text;

-- ---------- Data protection: delete bookings 12 months after the appointment --
-- Runs every night at 03:15. UK data protection law expects personal data not to
-- be kept longer than needed; 12 months covers repeat bookings and any queries.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'delete-old-bookings';
select cron.schedule(
  'delete-old-bookings',
  '15 3 * * *',
  $$delete from public.bookings where booking_date < (now() at time zone 'Europe/London')::date - interval '12 months'$$
);
