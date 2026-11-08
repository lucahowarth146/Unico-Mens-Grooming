// Your Supabase project. The anon key is a public key: it is safe in browser code.
// What it can do is controlled by the row-level security rules in your database.
export const SUPABASE_URL = "https://okddgqogvjnobbfizrcv.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZGRncW9ndmpub2JiZml6cmN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNjgzMzksImV4cCI6MjEwOTc0NDMzOX0.WMqvm02wlEu5MMWDMq1DMfgLRap0rG1e1G44DEM8eVM";

// The shop's own time zone. Every date and time on the site is in this zone,
// whatever time zone the visitor's device is set to.
export const SHOP_TIMEZONE = "Europe/London";

// Online booking: how far ahead customers can book, the gap between start times,
// and how soon a slot can be booked (minutes from now).
export const BOOKING_DAYS_AHEAD = 28;
export const SLOT_STEP_MINUTES = 15;
export const MIN_NOTICE_MINUTES = 30;
