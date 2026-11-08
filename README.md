# Unico Men's Grooming website

A static website (no build step) that uses Supabase for bookings, logins, services, photos and shop details.

| Page | Who it's for |
|---|---|
| `index.html` | Customers: services, barbers, gallery, reviews, map, online booking |
| `admin.html` | Owner: bookings (accept / decline / done / delete), calendar with a staff toggle, services, barbers, photos, shop details, your password and your staff's logins and passwords |
| `staff.html` | Each barber: only their own bookings (accept / decline / delete), their own calendar, their own password |

Every date and time is UK time (Europe/London), whatever time zone the visitor's phone or laptop is set to.

## Setup (your own Supabase project)

### 1. Create the database
1. Sign up at https://supabase.com and create a project (region: West EU (London)).
2. **SQL Editor → New query**, paste all of `supabase/setup.sql` and click **Run**.
   This creates every table, the access rules, double-booking protection, photo uploads,
   and fills in the current services, barbers, photos and shop details.
3. **Project Settings → API Keys**: copy the **Project URL** and the **anon public** key
   (under "Legacy API keys") into `js/config.js`.

### 2. Deploy the two functions
**Edge Functions → Deploy a new function → Via Editor** (turn **off** "Verify JWT" for both:
they check who's calling themselves):
- `notify-booking`: paste `supabase/functions/notify-booking/index.ts`
- `create-staff`: paste `supabase/functions/create-staff/index.ts`

### 3. Turn on emails
**Edge Functions → Secrets**, either:
- **Gmail** (easiest): `GMAIL_USER` = a Gmail address, `GMAIL_APP_PASSWORD` = an app password
  from https://myaccount.google.com/apppasswords (needs 2-step verification on that Google account), or
- **Resend** (needs your own domain): `RESEND_API_KEY` and `EMAIL_FROM`.

What gets sent:
- **New booking:** the customer gets "request received"; the barber (their staff login email) and the shop email get the details.
- **Accepted / declined:** the customer is told, and the barber gets a copy.

### 4. Sign in
**Authentication → Sign In / Providers → Email**: turn off **Confirm email** (or confirm from your inbox when asked).
Then go to `/admin.html` → "First time? Set up the owner account". The first account becomes the owner.
Add barbers in **Passwords & staff**; they sign in at `/staff.html`.

### Hosting
The site is static. It's deployed on Netlify from this GitHub repository: every push to `main` goes live.

## Booking statuses
`pending` (Awaiting reply) → `confirmed` (Accepted) → `completed` (Done). `cancelled` (Declined) frees the time slot.
The calendar counts **Done** bookings as services done, so mark bookings Done after the appointment.

## Settings
`js/config.js` holds the time zone, how many days ahead customers can book (28), the gap between start times (15 minutes) and the minimum notice (30 minutes).

## Worth checking
Staff only being able to see their own bookings is enforced by your database's row-level security rules on the `bookings` table, not just by the page.
The last lines of the SQL file show how to view those rules. If they let any signed-in user read every booking, tighten them so staff only reach rows where `barber_id` matches their own.
