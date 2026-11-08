// notify-booking: emails the customer, the barber and the shop about a booking.
//
// Called by the website with { booking_id, event }:
//   event "created"   → customer: request received; barber + shop: new booking
//   event "confirmed" → customer: booking accepted; barber: copy
//   event "cancelled" → customer: booking declined; barber: copy
//
// Secrets to set (Supabase Dashboard → Edge Functions → Secrets, or the CLI):
//   RESEND_API_KEY   your key from resend.com
//   EMAIL_FROM       e.g.  Unico Men's Grooming <bookings@your-domain.co.uk>
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("EMAIL_FROM") ?? "Unico Men's Grooming <onboarding@resend.dev>";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function prettyDate(d: string) {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]} ${day} ${MONTHS[m - 1]} ${y}`;
}

async function send(to: string | string[], subject: string, html: string, replyTo?: string) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: list, subject, html, reply_to: replyTo || undefined }),
  });
  if (!r.ok) throw new Error(`Email to ${list.join(", ")} failed: ${r.status} ${await r.text()}`);
}

function layout(shop: Record<string, any>, heading: string, intro: string, rows: [string, string][], footer = "") {
  const tr = rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#8a8178;width:120px;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;color:#1a1714">${esc(v)}</td></tr>`).join("");
  return `<div style="background:#f4f1ec;padding:24px 12px;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-top:4px solid #c5a572;padding:28px">
    <div style="font-size:12px;letter-spacing:4px;color:#c5a572;text-transform:uppercase">${esc(shop.name || "Unico Men's Grooming")}</div>
    <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:26px;margin:10px 0 12px;color:#1a1714">${esc(heading)}</h1>
    <p style="color:#3d3833;line-height:1.5;margin:0 0 16px">${intro}</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;border-bottom:1px solid #eee">${tr}</table>
    ${footer ? `<p style="color:#3d3833;line-height:1.5;margin:16px 0 0">${footer}</p>` : ""}
    <p style="color:#8a8178;font-size:13px;margin:22px 0 0">${esc(shop.address || "")}${shop.phone ? " · " + esc(shop.phone) : ""}</p>
  </div></div>`;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!RESEND) return json({ error: "RESEND_API_KEY is not set" }, 500);

  let body: { booking_id?: string; event?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const { booking_id, event } = body;
  if (!booking_id || !["created", "confirmed", "cancelled"].includes(event ?? "")) return json({ error: "booking_id and a valid event are required" }, 400);

  const { data: b } = await db.from("bookings").select("*, service:services(*), barber:barbers(*)").eq("id", booking_id).maybeSingle();
  if (!b) return json({ error: "Booking not found" }, 404);

  if (event === "created") {
    // Anyone can trigger this, so only for brand-new bookings.
    const age = Date.now() - new Date(b.created_at).getTime();
    if (b.status !== "pending" || age > 15 * 60 * 1000) return json({ error: "Too late to send booking emails for this booking" }, 409);
  } else {
    // Accept / decline emails: only the owner, or the booking's own barber.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return json({ error: "Sign in first" }, 401);
    const { data: me } = await db.from("admin_users").select("role, barber_id").eq("user_id", u.user.id).maybeSingle();
    if (!me || (me.role !== "owner" && me.barber_id !== b.barber_id)) return json({ error: "Not allowed" }, 403);
    if (b.status !== event) return json({ error: "Booking status doesn't match" }, 409);
  }

  const { data: shop } = await db.from("shop_settings").select("*").eq("id", 1).maybeSingle();
  const s = shop ?? {};
  const { data: staff } = b.barber_id
    ? await db.from("admin_users").select("email").eq("barber_id", b.barber_id)
    : { data: [] as { email: string }[] };
  const barberEmails = (staff ?? []).map(x => x.email).filter(Boolean);
  const barberName = b.barber?.name ?? "Any available barber";
  const when = `${prettyDate(b.booking_date)} at ${String(b.booking_time).slice(0, 5)} (UK time)`;
  const rows: [string, string][] = [
    ["Service", `${b.service?.name ?? "Service"} · ${b.service?.duration ?? ""} min`],
    ["Barber", barberName], ["When", when], ["Price", `£${Number(b.service?.price ?? 0).toFixed(2)}, pay in the shop`],
  ];
  const custRows: [string, string][] = [["Name", b.customer_name], ["Phone", b.customer_phone], ["Email", b.customer_email], ...(b.notes ? [["Notes", b.notes] as [string, string]] : [])];
  const errors: string[] = [];
  const attempt = (p: Promise<void>) => p.catch(e => errors.push(String(e.message ?? e)));

  if (event === "created") {
    await Promise.all([
      attempt(send(b.customer_email, `Booking request received: ${prettyDate(b.booking_date)}`,
        layout(s, "We've got your booking request", `Thanks ${esc(b.customer_name)}. Your barber will confirm it shortly and we'll email you again.`, rows,
          `Need to change it? Call us on ${esc(s.phone ?? "")}.`), s.shop_email)),
      attempt(send([...barberEmails, s.shop_email].filter(Boolean), `New booking request: ${b.customer_name}, ${when}`,
        layout(s, "New booking request", "Accept or decline it in the staff or owner area.", [...rows, ...custRows]), b.customer_email)),
    ]);
  } else if (event === "confirmed") {
    await Promise.all([
      attempt(send(b.customer_email, `Booking confirmed: ${prettyDate(b.booking_date)}`,
        layout(s, "You're booked in", `Good news ${esc(b.customer_name)}, your booking is confirmed. See you then.`, rows,
          `Can't make it? Please call us on ${esc(s.phone ?? "")} so we can offer the slot to someone else.`), s.shop_email)),
      attempt(send(barberEmails, `Accepted: ${b.customer_name}, ${when}`, layout(s, "Booking accepted", "This booking is confirmed.", [...rows, ...custRows]))),
    ]);
  } else {
    await Promise.all([
      attempt(send(b.customer_email, `We couldn't confirm your booking for ${prettyDate(b.booking_date)}`,
        layout(s, "Sorry, we can't make this one", `Hi ${esc(b.customer_name)}, unfortunately we can't fit in this booking.`, rows,
          `Please book another time on our website or call us on ${esc(s.phone ?? "")}.`), s.shop_email)),
      attempt(send(barberEmails, `Declined: ${b.customer_name}, ${when}`, layout(s, "Booking declined", "The customer has been told.", [...rows, ...custRows]))),
    ]);
  }

  return errors.length ? json({ ok: false, errors }, 502) : json({ ok: true });
});
