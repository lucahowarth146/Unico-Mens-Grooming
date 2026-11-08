import { createClient } from "./vendor/supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SHOP_TIMEZONE, SLOT_STEP_MINUTES, MIN_NOTICE_MINUTES } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- DOM helpers ---------- */
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "style") n.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "value") n.value = v;
    else if (k === "checked" || k === "selected" || k === "disabled") n[k] = !!v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
export function toast(msg, kind = "") {
  let t = $("#toast");
  if (!t) { t = el("div", { id: "toast", class: "toast", role: "status", "aria-live": "polite" }); document.body.append(t); }
  t.textContent = msg; t.className = "toast " + kind; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200);
}
export const gbp = n => "£" + Number(n || 0).toFixed(Number(n) % 1 ? 2 : 0);

/* ---------- Shop time zone ----------
   Dates are "YYYY-MM-DD" strings and times are "HH:MM" strings, both in the
   shop's time zone. We never build them from the visitor's local clock. */
const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
export function shopNow() {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export const toMin = t => { const [h, m] = String(t).slice(0, 5).split(":").map(Number); return h * 60 + m; };
export const fmtTime = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
export const hhmm = t => String(t || "").slice(0, 5);
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
export function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function prettyDate(dateStr, opts = {}) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = dayOfWeek(dateStr);
  const s = `${opts.short ? DAY_NAMES[dow].slice(0, 3) : DAY_NAMES[dow]} ${d} ${MONTHS[m - 1].slice(0, opts.short ? 3 : 20)}`;
  return opts.year ? s + " " + y : s;
}
export function hoursFor(settings, dateStr) {
  const k = DAY_KEYS[dayOfWeek(dateStr)];
  const open = hhmm(settings?.[k + "_open"]), close = hhmm(settings?.[k + "_close"]);
  return open && close ? { open: toMin(open), close: toMin(close) } : null;
}

/* ---------- Availability ----------
   busy: [{barber_id, start (min), end (min)}] for one date. */
export async function fetchBusy(dateStr) {
  const { data, error } = await sb.rpc("get_booked_slots", { p_date: dateStr });
  if (error) return { ok: false, busy: [] }; // migration not installed yet
  return { ok: true, busy: (data || []).map(r => ({ barber_id: r.barber_id, start: toMin(r.start_time), end: toMin(r.start_time) + (r.duration || 30) })) };
}
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
export function freeBarbers(barbers, busy, start, dur, wanted) {
  const ids = wanted === "any" ? barbers.map(b => b.id) : [wanted];
  const free = ids.filter(id => !busy.some(x => x.barber_id === id && overlaps(start, start + dur, x.start, x.end)));
  if (wanted === "any") {
    // bookings with no barber still take one chair
    const unassigned = busy.filter(x => !x.barber_id && overlaps(start, start + dur, x.start, x.end)).length;
    return free.length > unassigned ? free : [];
  }
  return free;
}
export function availableTimes({ settings, dateStr, dur, barbers, busy, wanted }) {
  const h = hoursFor(settings, dateStr);
  if (!h) return [];
  const now = shopNow();
  if (dateStr < now.date) return [];
  const earliest = dateStr === now.date ? now.minutes + MIN_NOTICE_MINUTES : -1;
  const out = [];
  for (let m = h.open; m + dur <= h.close; m += SLOT_STEP_MINUTES) {
    if (m < earliest) continue;
    if (freeBarbers(barbers, busy, m, dur, wanted).length) out.push(m);
  }
  return out;
}

/* ---------- Data ---------- */
export async function loadPublic() {
  const [s, sv, b, p] = await Promise.all([
    sb.from("shop_settings").select("*").eq("id", 1).maybeSingle(),
    sb.from("services").select("*").eq("active", true).order("sort_order"),
    sb.from("barbers").select("*").eq("active", true).order("sort_order"),
    sb.from("photos").select("*").order("sort_order"),
  ]);
  return { settings: s.data || {}, services: sv.data || [], barbers: b.data || [], photos: p.data || [], error: s.error || sv.error || b.error || p.error };
}

/* ---------- Email notifications ----------
   notify-booking (in supabase/functions) emails the customer, the barber and the shop.
   Returns false if it isn't deployed or the email service isn't set up. */
export async function notify(bookingId, event) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token || SUPABASE_ANON_KEY;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/notify-booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ booking_id: bookingId, event }),
    });
    if (r.ok) return true;
    return false;
  } catch { return false; }
}

/* ---------- Image upload ----------
   Uploads to the public "site-images" storage bucket (created by the migration).
   Large photos are resized in the browser first. Returns a public URL. */
export async function uploadImage(file, folder = "misc") {
  const blob = await shrink(file, 1600, 0.85);
  const ext = blob.type === "image/png" ? "png" : "jpg";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from("site-images").upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw new Error("Upload failed: " + error.message + ". Check that the storage migration has been run.");
  return sb.storage.from("site-images").getPublicUrl(path).data.publicUrl;
}
async function shrink(file, max, q) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 900_000) return file;
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  return await new Promise(res => c.toBlob(b => res(b || file), type, q));
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
export const STATUS_LABEL = { pending: "Awaiting reply", confirmed: "Accepted", completed: "Done", cancelled: "Declined" };

/* ---------- Sharp images ----------
   Google and Pexels photo links carry a size in the address. Ask for the size
   the page actually needs (2x for sharp phone and Retina screens). */
export function sharp(url, width) {
  if (!url) return url;
  const w = Math.round(width);
  if (/googleusercontent\.com/.test(url)) return url.replace(/=[^=\/]*$/, "") + "=w" + w;
  if (/images\.pexels\.com/.test(url)) {
    const u = new URL(url);
    u.searchParams.set("auto", "compress"); u.searchParams.set("cs", "tinysrgb"); u.searchParams.set("w", String(w));
    u.searchParams.delete("h"); u.searchParams.delete("dpr");
    return u.toString();
  }
  return url;
}
// <img> attributes for a sharp photo: a sized src plus a srcset so phones download less.
export function sharpAttrs(url, cssWidth) {
  if (!/googleusercontent\.com|images\.pexels\.com/.test(url || "")) return { src: url };
  const sizes = [cssWidth, cssWidth * 2, cssWidth * 3].map(Math.round);
  return { src: sharp(url, cssWidth * 2), srcset: sizes.map(s => `${sharp(url, s)} ${s}w`).join(", ") };
}
