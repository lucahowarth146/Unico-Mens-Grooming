// Your Supabase project. The anon key is a public key: it is safe in browser code.
// What it can do is controlled by the row-level security rules in your database.
export const SUPABASE_URL = "https://voaiwpfwmfuqrblmbfbp.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvYWl3cGZ3bWZ1cXJibG1iZmJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNzAzODIsImV4cCI6MjEwMzg0NjM4Mn0.npxAIeMSln6M-zYkDgHyuRSsV_xCU9pGkn7f8rBQeXc";

// The shop's own time zone. Every date and time on the site is in this zone,
// whatever time zone the visitor's device is set to.
export const SHOP_TIMEZONE = "Europe/London";

// Online booking: how far ahead customers can book, the gap between start times,
// and how soon a slot can be booked (minutes from now).
export const BOOKING_DAYS_AHEAD = 28;
export const SLOT_STEP_MINUTES = 15;
export const MIN_NOTICE_MINUTES = 30;
