-- ============================================================================
-- Unico security update: stops spam bookings and repeated emails.
-- Safe to run more than once. Already part of setup.sql for new projects.
-- ============================================================================

-- Each booking's confirmation email is only sent once.
alter table public.bookings add column if not exists notified_at timestamptz;

-- Checks every booking made from the website before it's saved.
create or replace function public.check_new_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_now      timestamp := now() at time zone 'Europe/London';
  v_dur      int;
  v_open     text;
  v_close    text;
  v_day      text := lower(to_char(new.booking_date, 'dy'));
  v_digits   text := regexp_replace(coalesce(new.customer_phone, ''), '\D', '', 'g');
begin
  -- The owner and barbers adding bookings themselves skip these checks.
  if public.is_owner() or public.my_barber() is not null then return new; end if;

  -- Sensible details only.
  if length(trim(new.customer_name)) < 2 or length(new.customer_name) > 80 then raise exception 'invalid_booking: name'; end if;
  if new.customer_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(new.customer_email) > 120 then raise exception 'invalid_booking: email'; end if;
  if length(v_digits) < 10 or length(v_digits) > 15 then raise exception 'invalid_booking: phone'; end if;
  if length(coalesce(new.notes, '')) > 500 then raise exception 'invalid_booking: notes'; end if;
  new.customer_email := lower(trim(new.customer_email));
  new.status := 'pending';
  new.notified_at := null;

  -- Only real, bookable times: within 60 days, inside opening hours, not in the past.
  if new.booking_date > (v_now::date + 60) then raise exception 'invalid_booking: too far ahead'; end if;
  if new.booking_date + new.booking_time < v_now then raise exception 'invalid_booking: in the past'; end if;
  if new.service_id is null or not exists (select 1 from services where id = new.service_id and active) then raise exception 'invalid_booking: service'; end if;
  if new.barber_id is not null and not exists (select 1 from barbers where id = new.barber_id and active) then raise exception 'invalid_booking: barber'; end if;
  execute format('select %I, %I from shop_settings where id = 1', v_day || '_open', v_day || '_close') into v_open, v_close;
  select duration into v_dur from services where id = new.service_id;
  if coalesce(v_open, '') = '' or coalesce(v_close, '') = ''
     or new.booking_time < v_open::time
     or new.booking_time + make_interval(mins => coalesce(v_dur, 30)) > v_close::time then
    raise exception 'invalid_booking: outside opening hours';
  end if;

  -- Spam limits: one person can hold at most 3 upcoming bookings,
  -- and the whole site accepts at most 20 new bookings in any 10 minutes.
  if (select count(*) from bookings
        where status in ('pending', 'confirmed') and booking_date >= v_now::date
          and (lower(customer_email) = new.customer_email
               or regexp_replace(customer_phone, '\D', '', 'g') = v_digits)) >= 3 then
    raise exception 'too_many_bookings: this email or phone already has 3 upcoming bookings';
  end if;
  if (select count(*) from bookings where created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'too_many_bookings: the booking system is busy, try again shortly';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_check_new on public.bookings;
create trigger bookings_check_new before insert on public.bookings
  for each row execute function public.check_new_booking();

-- Used by the email function: marks a booking as emailed, and only succeeds the first time.
create or replace function public.claim_booking_email(p_id uuid) returns boolean
language sql security definer set search_path = public as $$
  update bookings set notified_at = now() where id = p_id and notified_at is null returning true;
$$;
revoke all on function public.claim_booking_email(uuid) from public, anon, authenticated;
grant execute on function public.claim_booking_email(uuid) to service_role;
