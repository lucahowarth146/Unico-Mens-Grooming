-- ============================================================================
-- Unico Men's Grooming: complete database setup for a NEW Supabase project.
-- Supabase → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------------------------------------------------------
create table if not exists public.shop_settings (
  id int primary key default 1 check (id = 1),
  name text, tagline text, address text, phone text,
  rating numeric default 5, review_count int default 0,
  about text, hero_image text, opening_hours text,
  mon_open text, mon_close text, tue_open text, tue_close text, wed_open text, wed_close text,
  thu_open text, thu_close text, fri_open text, fri_close text, sat_open text, sat_close text,
  sun_open text, sun_close text,
  instagram text, facebook text, tiktok text, shop_email text
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text default '', price numeric not null default 0,
  duration int not null default 30, category text default 'Other',
  sort_order int default 0, active boolean default true, created_at timestamptz default now()
);

create table if not exists public.barbers (
  id uuid primary key default gen_random_uuid(),
  name text not null, title text default '', bio text default '', photo text default '',
  sort_order int default 0, active boolean default true, created_at timestamptz default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  url text not null, caption text default '', category text default 'Our Work',
  sort_order int default 0, created_at timestamptz default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null, customer_email text not null, customer_phone text not null,
  service_id uuid references public.services(id),
  barber_id uuid references public.barbers(id),
  booking_date date not null, booking_time time not null,
  notes text default '',
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled')),
  created_at timestamptz default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','staff')),
  barber_id uuid references public.barbers(id) on delete set null,
  created_at timestamptz default now()
);

-- ---------- Who is signed in ------------------------------------------------
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where user_id = auth.uid() and role = 'owner');
$$;
create or replace function public.my_barber() returns uuid
language sql stable security definer set search_path = public as $$
  select barber_id from admin_users where user_id = auth.uid() and role = 'staff';
$$;

-- The first person to call this becomes the owner. After that it refuses.
create or replace function public.claim_owner_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from admin_users where role = 'owner') then raise exception 'owner_exists'; end if;
  insert into admin_users (user_id, email, role)
  select id, email, 'owner' from auth.users where id = auth.uid();
end;
$$;

-- ---------- Access rules (row level security) -------------------------------
alter table public.shop_settings enable row level security;
alter table public.services      enable row level security;
alter table public.barbers       enable row level security;
alter table public.photos        enable row level security;
alter table public.bookings      enable row level security;
alter table public.admin_users   enable row level security;

do $$
declare t text;
begin
  -- Website content: everyone can read, only the owner can change.
  foreach t in array array['shop_settings','services','barbers','photos'] loop
    execute format('drop policy if exists "anyone can read" on public.%I', t);
    execute format('create policy "anyone can read" on public.%I for select using (true)', t);
    execute format('drop policy if exists "owner can change" on public.%I', t);
    execute format('create policy "owner can change" on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

-- Bookings: anyone can make one; the owner sees all; each barber only their own.
drop policy if exists "anyone can book"          on public.bookings;
drop policy if exists "owner sees all bookings"  on public.bookings;
drop policy if exists "staff see own bookings"   on public.bookings;
create policy "anyone can book" on public.bookings for insert to anon, authenticated
  with check (status = 'pending' and booking_date >= (now() at time zone 'Europe/London')::date);
create policy "owner sees all bookings" on public.bookings for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy "staff see own bookings" on public.bookings for all to authenticated
  using (barber_id is not null and barber_id = public.my_barber())
  with check (barber_id is not null and barber_id = public.my_barber());

-- Admin accounts: you see your own row; the owner sees everyone's.
drop policy if exists "see own admin row" on public.admin_users;
create policy "see own admin row" on public.admin_users for select to authenticated
  using (user_id = auth.uid() or public.is_owner());

grant usage on schema public to anon, authenticated, service_role;
-- Supabase's own server account (used by the email and staff-login functions) needs full access.
-- Without this, projects created with "Automatically expose new tables" off can't send emails.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
grant select on public.shop_settings, public.services, public.barbers, public.photos to anon, authenticated;
grant insert, update, delete on public.shop_settings, public.services, public.barbers, public.photos to authenticated;
grant insert on public.bookings to anon, authenticated;
grant select, update, delete on public.bookings to authenticated;
grant select on public.admin_users to authenticated;
revoke all on function public.is_owner(), public.my_barber(), public.claim_owner_account() from public;
grant execute on function public.is_owner(), public.my_barber() to anon, authenticated;
grant execute on function public.claim_owner_account() to authenticated;

-- ---------- Taken times (no customer details) --------------------------------
create or replace function public.get_booked_slots(p_date date)
returns table (barber_id uuid, start_time text, duration int)
language sql stable security definer set search_path = public as $$
  select b.barber_id, to_char(b.booking_time, 'HH24:MI'), coalesce(s.duration, 30)::int
  from bookings b left join services s on s.id = b.service_id
  where b.booking_date = p_date and b.status <> 'cancelled';
$$;
revoke all on function public.get_booked_slots(date) from public;
grant execute on function public.get_booked_slots(date) to anon, authenticated;

-- ---------- No double bookings ----------------------------------------------
create or replace function public.prevent_double_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_dur int;
begin
  if new.barber_id is null or new.status = 'cancelled' then return new; end if;
  if tg_op = 'UPDATE' and new.barber_id is not distinct from old.barber_id
     and new.booking_date = old.booking_date and new.booking_time = old.booking_time
     and old.status <> 'cancelled' then return new; end if;
  select coalesce(duration, 30) into v_dur from services where id = new.service_id;
  v_dur := coalesce(v_dur, 30);
  if exists (
    select 1 from bookings b left join services s on s.id = b.service_id
    where b.id <> new.id and b.barber_id = new.barber_id and b.booking_date = new.booking_date
      and b.status <> 'cancelled'
      and b.booking_time < new.booking_time + make_interval(mins => v_dur)
      and new.booking_time < b.booking_time + make_interval(mins => coalesce(s.duration, 30))
  ) then
    raise exception 'slot_taken: that barber already has a booking at this time';
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_no_overlap on public.bookings;
create trigger bookings_no_overlap before insert or update on public.bookings
  for each row execute function public.prevent_double_booking();

-- ---------- Photo uploads ---------------------------------------------------
insert into storage.buckets (id, name, public) values ('site-images', 'site-images', true)
on conflict (id) do update set public = true;
drop policy if exists "site-images: anyone can view"   on storage.objects;
drop policy if exists "site-images: owner can upload"  on storage.objects;
drop policy if exists "site-images: owner can replace" on storage.objects;
drop policy if exists "site-images: owner can delete"  on storage.objects;
create policy "site-images: anyone can view"   on storage.objects for select using (bucket_id = 'site-images');
create policy "site-images: owner can upload"  on storage.objects for insert to authenticated with check (bucket_id = 'site-images' and public.is_owner());
create policy "site-images: owner can replace" on storage.objects for update to authenticated using (bucket_id = 'site-images' and public.is_owner());
create policy "site-images: owner can delete"  on storage.objects for delete to authenticated using (bucket_id = 'site-images' and public.is_owner());

-- ---------- Spam protection and send-once emails ----------

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

-- ---------- Your current content (only added if the tables are empty) --------
insert into public.shop_settings (id, hero_image, name, tagline, address, phone, rating, review_count, about, opening_hours, mon_open, mon_close, tue_open, tue_close, wed_open, wed_close, thu_open, thu_close, fri_open, fri_close, sat_open, sat_close, sun_open, sun_close, instagram, facebook, tiktok, shop_email) values (1, null, 'Unico Men''s Grooming', 'Premium grooming for the modern gentleman', '172 Washway Rd, Sale M33 6RH', '0161 385 8362', 5.0, 197, 'Unico Men''s Grooming is Sale''s premier barbershop, delivering precision cuts, traditional wet shaves, and expert beard care in a relaxed, stylish setting. Our experienced barbers combine classic techniques with modern trends to give every client a look they love.', 'Open Monday–Saturday · Closes 6:30 pm', '09:00', '18:30', '09:00', '18:30', '09:00', '18:30', '09:00', '18:30', '09:00', '18:30', '09:00', '18:30', null, null, 'https://www.instagram.com/unicomensgrooming?dlrf=bDBjcTg0YW5iMGV0', null, null, 'lucaleehowarth@gmail.com')
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from public.services) then
    insert into public.services (name, description, price, duration, category, sort_order, active) values
      ('Gents Hair Cut', 'Consultation, cut, and finish tailored to your style', 22.0, 45, 'Hair', 0, true),
      ('Skin Fade', 'Seamless blended fade from skin to length', 24.0, 45, 'Hair', 1, true),
      ('Buzz Cut', 'Clean, even all-over cut with clippers', 12.0, 20, 'Hair', 2, true),
      ('Scissor Cut', 'Precision scissor-only cut for texture and length', 22.0, 45, 'Hair', 3, true),
      ('Curly Hair', 'Specialist cut and shaping for curly and textured hair', 25.0, 50, 'Hair', 4, true),
      ('Custom Cut', 'Bespoke cut designed around your preferences', 25.0, 50, 'Hair', 5, true),
      ('Hair Shape-Up', 'Line-up and edge refresh between cuts', 10.0, 20, 'Hair', 6, true),
      ('Head Shave', 'Smooth head shave with hot towel finish', 18.0, 30, 'Hair', 7, true),
      ('Shampoo & Conditioning', 'Wash and conditioning treatment', 8.0, 15, 'Hair', 8, true),
      ('Children''s Cuts', 'Cuts for under-12s in a relaxed chair', 14.0, 30, 'Hair', 9, true),
      ('Beard Trim', 'Shape, line, and tidy your beard', 10.0, 20, 'Beard', 10, true),
      ('Beard Conditioning', 'Conditioning treatment to soften and nourish', 12.0, 20, 'Beard', 11, true),
      ('Hot Towel Shave', 'Traditional cut-throat shave with hot towels', 22.0, 40, 'Beard', 12, true),
      ('Shave', 'Clean, professional shave', 15.0, 30, 'Beard', 13, true),
      ('Eyebrow Trimming', 'Tidy and shape brows', 6.0, 10, 'Waxing & Details', 14, true),
      ('Nose Wax', 'Quick nostril wax', 6.0, 10, 'Waxing & Details', 15, true),
      ('Ear Wax', 'Quick ear wax', 6.0, 10, 'Waxing & Details', 16, true),
      ('Groom Package', 'Hair cut, beard trim, and hot towel shave', 45.0, 75, 'Groom Packages', 17, true);
  end if;
  if not exists (select 1 from public.barbers) then
    insert into public.barbers (name, title, bio, photo, sort_order, active) values
      ('Cam', 'Master Barber & Founder', 'With over 15 years behind the chair, Cam founded Unico to bring old-world craftsmanship to Sale. Specialist in scissor work and skin fades.', 'https://images.pexels.com/photos/3998405/pexels-photo-3998405.jpeg?auto=compress&cs=tinysrgb&w=1200', 0, true),
      ('Oscar', 'Senior Barber', 'Oscar is our fade and beard specialist. He lives for sharp lines and clean transitions.', 'https://images.pexels.com/photos/4625619/pexels-photo-4625619.jpeg?auto=compress&cs=tinysrgb&w=1200', 1, true);
  end if;
  if not exists (select 1 from public.photos) then
    insert into public.photos (url, caption, category, sort_order) values
      ('https://images.pexels.com/photos/7518740/pexels-photo-7518740.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Precision work', 'Our Work', 0),
      ('https://images.pexels.com/photos/12464841/pexels-photo-12464841.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Skin fade detail', 'Our Work', 1),
      ('https://images.pexels.com/photos/3998405/pexels-photo-3998405.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Beard grooming', 'Our Work', 2),
      ('https://images.pexels.com/photos/7518729/pexels-photo-7518729.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Hair wash', 'Our Work', 3),
      ('https://images.pexels.com/photos/7518692/pexels-photo-7518692.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Relax and wait', 'Interior', 4);
  end if;
end $$;
