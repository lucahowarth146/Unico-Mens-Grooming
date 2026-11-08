# Unico Men's Grooming website

A static website (no build step) that uses your existing Supabase project
(`voaiwpfwmfuqrblmbfbp`) for bookings, logins, services, photos and shop details.

| Page | Who it's for |
|---|---|
| `index.html` | Customers: services, barbers, gallery, reviews, map, online booking |
| `admin.html` | Owner: bookings (accept / decline / done / delete), calendar with a staff toggle, services, barbers, photos, shop details, your password and your staff's logins and passwords |
| `staff.html` | Each barber: only their own bookings (accept / decline / delete), their own calendar, their own password |

Every date and time is UK time (Europe/London), whatever time zone the visitor's phone or laptop is set to.

## Setup: 3 steps

### 1. Update the database (about 2 minutes)
Supabase Dashboard → **SQL Editor** → New query → paste all of
`supabase/migrations/20261107_booking_upgrade.sql` → **Run**.

This adds:
- the live "which times are taken" check, so customers only see free times;
- a guard so the same barber can never be double-booked;
- a `site-images` storage area for uploading photos from the admin area (only the owner can upload).

Until you run it the site still works, but every time shows as free and photo uploads won't work (pasting an image link still does).

### 2. Turn on emails to the customer and the barber (about 10 minutes)
Emails are sent through [Resend](https://resend.com), which is free for up to 3,000 emails a month.

1. Create a Resend account, add and verify your domain (e.g. `unicomensgrooming.co.uk`), and create an API key.
2. In Supabase: **Edge Functions → Secrets**, add:
   - `RESEND_API_KEY`: your Resend key
   - `EMAIL_FROM`: e.g. `Unico Men's Grooming <bookings@unicomensgrooming.co.uk>`
3. Deploy the function, either with the Supabase CLI from this folder:

   ```bash
   npx supabase functions deploy notify-booking --project-ref voaiwpfwmfuqrblmbfbp
   ```

   or in the dashboard: **Edge Functions → Deploy a new function → Via Editor**, name it `notify-booking` and paste in `supabase/functions/notify-booking/index.ts`.

What gets sent:
- **New booking:** the customer gets "request received". The barber (the email on their staff login) and the shop email get the booking details.
- **Accepted:** the customer gets "you're booked in", and the barber gets a copy.
- **Declined:** the customer gets "sorry, we can't make this one", and the barber gets a copy.

Until it's deployed, new bookings fall back to your existing `send-booking-email` function, which emails the customer and the shop but not the barber.

A barber only gets emails once they have a staff login linked to them (admin → Passwords & staff).

### 3. Put the site online
Upload the whole folder (everything except `supabase/` and this README) to any static host:
- **Netlify:** drag the folder onto https://app.netlify.com/drop
- **Vercel**, **Cloudflare Pages** or **GitHub Pages** work too. There's no build command, and the output folder is the root.

Then, in Supabase → **Authentication → URL Configuration**, set the Site URL to your new address.

## First login
- **Owner:** go to `/admin.html` and sign in with your existing owner email and password. If no owner account exists yet, use "First time? Set up the owner account".
- **Staff:** the owner creates each barber's login in **Passwords & staff**. Barbers sign in at `/staff.html`.

## Booking statuses
`pending` (Awaiting reply) → `confirmed` (Accepted) → `completed` (Done). `cancelled` (Declined) frees the time slot.
The calendar counts **Done** bookings as services done, so mark bookings Done after the appointment.

## Settings
`js/config.js` holds the time zone, how many days ahead customers can book (28), the gap between start times (15 minutes) and the minimum notice (30 minutes).

## Worth checking
Staff only being able to see their own bookings is enforced by your database's row-level security rules on the `bookings` table, not just by the page.
The last lines of the SQL file show how to view those rules. If they let any signed-in user read every booking, tighten them so staff only reach rows where `barber_id` matches their own.
