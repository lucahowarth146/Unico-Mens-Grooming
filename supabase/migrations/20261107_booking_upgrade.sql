-- Unico booking upgrade
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- It is safe to run more than once.
--
-- What it adds:
--   1. get_booked_slots(date): lets the website see which times are taken,
--      without exposing any customer details.
--   2. A guard that stops two bookings overlapping for the same barber.
--   3. A public "site-images" storage bucket that only the owner can upload to,
--      used by the admin area to upload and replace photos.

-- 1. Taken times for one day (no names, emails or phone numbers) -------------
create or replace function public.get_booked_slots(p_date date)
returns table (barber_id uuid, start_time text, duration int)
language sql
stable
security definer
set search_path = public
as $$
  select b.barber_id,
         to_char(b.booking_time::text::time, 'HH24:MI') as start_time,
         coalesce(s.duration, 30)::int as duration
  from bookings b
  left join services s on s.id = b.service_id
  where b.booking_date::text::date = p_date
    and coalesce(b.status, 'pending') <> 'cancelled';
$$;
revoke all on function public.get_booked_slots(date) from public;
grant execute on function public.get_booked_slots(date) to anon, authenticated;

-- 2. No double bookings -------------------------------------------------------
create or replace function public.prevent_double_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start time;
  v_dur   int;
begin
  if new.barber_id is null or coalesce(new.status, 'pending') = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.barber_id   is not distinct from old.barber_id
     and new.booking_date is not distinct from old.booking_date
     and new.booking_time is not distinct from old.booking_time
     and old.status <> 'cancelled' then
    return new;  -- nothing that affects the timetable changed
  end if;

  select coalesce(duration, 30) into v_dur from services where id = new.service_id;
  v_dur   := coalesce(v_dur, 30);
  v_start := new.booking_time::text::time;

  if exists (
    select 1
    from bookings b
    left join services s on s.id = b.service_id
    where b.id <> new.id
      and b.barber_id = new.barber_id
      and b.booking_date::text::date = new.booking_date::text::date
      and coalesce(b.status, 'pending') <> 'cancelled'
      and b.booking_time::text::time < v_start + make_interval(mins => v_dur)
      and v_start < b.booking_time::text::time + make_interval(mins => coalesce(s.duration, 30))
  ) then
    raise exception 'slot_taken: that barber already has a booking at this time';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_no_overlap on public.bookings;
create trigger bookings_no_overlap
  before insert or update on public.bookings
  for each row execute function public.prevent_double_booking();

-- 3. Photo uploads -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do update set public = true;

drop policy if exists "site-images: anyone can view"      on storage.objects;
drop policy if exists "site-images: owner can upload"     on storage.objects;
drop policy if exists "site-images: owner can replace"    on storage.objects;
drop policy if exists "site-images: owner can delete"     on storage.objects;

create policy "site-images: anyone can view" on storage.objects
  for select using (bucket_id = 'site-images');

create policy "site-images: owner can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-images'
    and exists (select 1 from public.admin_users a where a.user_id = auth.uid() and a.role = 'owner'));

create policy "site-images: owner can replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-images'
    and exists (select 1 from public.admin_users a where a.user_id = auth.uid() and a.role = 'owner'));

create policy "site-images: owner can delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-images'
    and exists (select 1 from public.admin_users a where a.user_id = auth.uid() and a.role = 'owner'));

-- Check: who can read bookings?
-- Staff should only reach their own bookings. The staff page only asks for the
-- signed-in barber's bookings, but the database rules are what actually enforce it.
-- Run this to see the current rules on the bookings table:
--   select policyname, cmd, roles, qual from pg_policies where tablename = 'bookings';
