import { sb, $, el, toast, gbp, shopNow, addDays, dayOfWeek, prettyDate, hhmm, toMin, DAY_KEYS, DAY_NAMES, MONTHS,
  notify, uploadImage, STATUS_LABEL } from "./lib.js";

const MODE = document.body.dataset.mode; // "owner" or "staff"
const app = $("#app");
const S = { me: null, view: "bookings", bookings: [], services: [], barbers: [], photos: [], settings: {}, admins: [],
  filter: { status: "active", barber: "all", when: "upcoming" }, cal: { month: shopNow().date.slice(0, 7), barber: "all", day: null } };

/* ======================= sign in ======================= */
function loginScreen(mode = "signin", msg = "") {
  const isOwner = MODE === "owner";
  const title = mode === "setup" ? "Create owner account" : isOwner ? "Owner sign in" : "Staff sign in";
  const f = { email: "", pw: "", pw2: "" };
  const err = el("p", { class: "err", role: "alert" }, msg);
  const btn = el("button", { class: "btn", type: "submit" }, mode === "setup" ? "Create account" : "Sign in");
  const form = el("form", { class: "box", onsubmit: async e => {
    e.preventDefault(); err.textContent = "";
    if (!f.email.includes("@") || f.pw.length < 8) { err.textContent = "Enter your email and a password of at least 8 characters."; return; }
    if (mode === "setup" && f.pw !== f.pw2) { err.textContent = "The two passwords don't match."; return; }
    btn.disabled = true; btn.textContent = "Signing in…";
    const r = mode === "setup" ? await sb.auth.signUp({ email: f.email.trim(), password: f.pw }) : await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.pw });
    if (r.error || !r.data.user) { btn.disabled = false; btn.textContent = "Sign in"; err.textContent = mode === "setup" ? "The owner account couldn't be created. " + (r.error?.message || "") : "That email and password weren't recognised."; return; }
    if (mode === "setup") {
      const { error } = await sb.rpc("claim_owner_account");
      if (error) { await sb.auth.signOut(); btn.disabled = false; btn.textContent = "Create account"; err.textContent = "The shop already has an owner account. Sign in instead."; return; }
    }
    boot();
  } },
    el("img", { src: "img/logo.png", alt: "Unico" }),
    el("h1", {}, title),
    el("p", { class: "sub" }, isOwner ? "Manage bookings, services, photos, staff and shop details." : "See and manage your own bookings."),
    el("div", { class: "field" }, el("label", { for: "le" }, "Email"), el("input", { id: "le", type: "email", autocomplete: "username", required: true, oninput: e => (f.email = e.target.value) })),
    el("div", { class: "field" }, el("label", { for: "lp" }, "Password"), el("input", { id: "lp", type: "password", autocomplete: mode === "setup" ? "new-password" : "current-password", required: true, oninput: e => (f.pw = e.target.value) })),
    mode === "setup" ? el("div", { class: "field" }, el("label", { for: "lp2" }, "Repeat password"), el("input", { id: "lp2", type: "password", autocomplete: "new-password", oninput: e => (f.pw2 = e.target.value) })) : null,
    err, btn,
    isOwner ? el("button", { class: "link", type: "button", style: "justify-self:center", onclick: () => loginScreen(mode === "setup" ? "signin" : "setup") }, mode === "setup" ? "Already set up? Sign in" : "First time? Set up the owner account") : null,
    el("a", { class: "link", href: "index.html", style: "justify-self:center" }, "Back to the website"),
    el("a", { class: "link", href: isOwner ? "staff.html" : "admin.html", style: "justify-self:center" }, isOwner ? "Staff member? Use the staff login" : "Shop owner? Use the owner login"));
  app.replaceChildren(el("div", { class: "login" }, form));
  $("#le")?.focus();
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginScreen();
  const { data: me, error } = await sb.from("admin_users").select("*, barber:barbers(*)").eq("user_id", session.user.id).maybeSingle();
  if (error || !me) { await sb.auth.signOut(); return loginScreen("signin", "This account doesn't have access to the admin area."); }
  if (MODE === "owner" && me.role !== "owner") { await sb.auth.signOut(); return loginScreen("signin", "This is a staff account. Use the staff login page instead."); }
  if (MODE === "staff" && me.role === "owner") { location.href = "admin.html"; return; }
  if (MODE === "staff" && !me.barber_id) { await sb.auth.signOut(); return loginScreen("signin", "Your account isn't linked to a barber yet. Ask the owner to link it."); }
  S.me = { ...me, email: me.email || session.user.email };
  await loadAll();
  shell();
}

/* ======================= data ======================= */
async function loadBookings() {
  let q = sb.from("bookings").select("*, service:services(*), barber:barbers(*)").order("booking_date", { ascending: true }).order("booking_time", { ascending: true });
  if (MODE === "staff") q = q.eq("barber_id", S.me.barber_id);
  const { data, error } = await q;
  if (error) toast("Bookings couldn't be loaded: " + error.message, "err");
  S.bookings = (data || []).map(b => ({ ...b, booking_time: hhmm(b.booking_time), booking_date: String(b.booking_date).slice(0, 10) }));
}
async function loadAll() {
  const jobs = [loadBookings(), sb.from("barbers").select("*").order("sort_order").then(r => (S.barbers = r.data || []))];
  if (MODE === "owner") jobs.push(
    sb.from("services").select("*").order("sort_order").then(r => (S.services = r.data || [])),
    sb.from("photos").select("*").order("sort_order").then(r => (S.photos = r.data || [])),
    sb.from("shop_settings").select("*").eq("id", 1).maybeSingle().then(r => (S.settings = r.data || {})),
    loadAdmins());
  await Promise.all(jobs);
}
async function loadAdmins() { const r = await sb.from("admin_users").select("*, barber:barbers(*)").order("created_at"); S.admins = r.data || []; }

/* ======================= shell ======================= */
const VIEWS_OWNER = [["bookings", "Bookings"], ["calendar", "Calendar"], ["services", "Services"], ["barbers", "Barbers"], ["photos", "Photos"], ["details", "Shop details"], ["access", "Passwords & staff"]];
const VIEWS_STAFF = [["bookings", "My bookings"], ["calendar", "My calendar"], ["access", "My password"]];
function shell() {
  const views = MODE === "owner" ? VIEWS_OWNER : VIEWS_STAFF;
  const pending = S.bookings.filter(b => b.status === "pending").length;
  app.replaceChildren(el("div", { class: "adm" },
    el("aside", { class: "side" },
      el("a", { class: "brand", href: "index.html", title: "View website" }, el("img", { src: "img/logo.png", alt: "" }), el("span", {}, "UNICO")),
      el("nav", { "aria-label": "Admin sections" }, ...views.map(([k, n]) => el("button", { "aria-current": S.view === k ? "page" : false, onclick: () => { S.view = k; shell(); } },
        el("span", {}, n), k === "bookings" && pending ? el("span", { class: "badge", title: pending + " awaiting reply" }, pending) : null))),
      el("div", { class: "who" }, el("span", {}, MODE === "owner" ? "Owner" : S.me.barber?.name || "Staff", el("br"), el("span", { style: "font-size:12px" }, S.me.email)),
        el("button", { class: "link", onclick: async () => { await sb.auth.signOut(); loginScreen(); } }, "Sign out"))),
    el("main", { class: "main", id: "main" })));
  ({ bookings: viewBookings, calendar: viewCalendar, services: viewServices, barbers: viewBarbers, photos: viewPhotos, details: viewDetails, access: viewAccess })[S.view]();
}
const main = (...kids) => $("#main").replaceChildren(...kids.filter(k => k != null && k !== false));
const head = (t, sub) => el("div", {}, el("h1", {}, t), sub ? el("p", { class: "sub" }, sub) : null);
const field = (label, input) => el("div", { class: "field" }, el("label", { for: input.id }, label), input);
let fid = 0; const nid = () => "f" + ++fid;

/* ======================= bookings ======================= */
function bookingActions(b, rerender) {
  const box = el("div", { class: "actions" });
  const setStatus = async (status, label) => {
    box.querySelectorAll("button").forEach(x => (x.disabled = true));
    const { error } = await sb.from("bookings").update({ status }).eq("id", b.id);
    if (error) { toast("Couldn't update: " + error.message, "err"); rerender(); return; }
    b.status = status; toast(label);
    if (status === "confirmed" || status === "cancelled") notify(b.id, status).then(ok => { if (!ok) toast(label + ". The customer email didn't send.", "err"); });
    rerender();
  };
  if (b.status === "pending") box.append(el("button", { class: "btn sm ok", onclick: () => setStatus("confirmed", "Booking accepted") }, "Accept"));
  if (b.status === "pending" || b.status === "confirmed") box.append(el("button", { class: "btn sm danger", onclick: () => setStatus("cancelled", "Booking declined") }, "Decline"));
  if (b.status === "confirmed") box.append(el("button", { class: "btn sm ghost", onclick: () => setStatus("completed", "Marked as done") }, "Mark done"));
  if (b.status === "cancelled") box.append(el("button", { class: "btn sm ghost", onclick: () => setStatus("pending", "Booking restored") }, "Restore"));
  box.append(el("button", { class: "btn sm ghost", onclick: () => {
    box.replaceChildren(el("span", { class: "inline-confirm" }, "Delete for good?",
      el("button", { class: "btn sm danger", onclick: async () => {
        const { error } = await sb.from("bookings").delete().eq("id", b.id);
        if (error) { toast("Couldn't delete: " + error.message, "err"); return rerender(); }
        S.bookings = S.bookings.filter(x => x.id !== b.id); toast("Booking deleted"); rerender();
      } }, "Delete"), el("button", { class: "btn sm ghost", onclick: rerender }, "Keep")));
  } }, "Delete"));
  return box;
}

function viewBookings() {
  const now = shopNow(), F = S.filter;
  const weekEnd = addDays(now.date, 7), monthKey = now.date.slice(0, 7);
  const stats = [
    [S.bookings.filter(b => b.status === "pending").length, "Awaiting your reply"],
    [S.bookings.filter(b => b.booking_date === now.date && b.status !== "cancelled").length, "Booked today"],
    [S.bookings.filter(b => b.booking_date >= now.date && b.booking_date < weekEnd && b.status !== "cancelled").length, "Next 7 days"],
    [S.bookings.filter(b => b.booking_date.startsWith(monthKey) && b.status === "completed").length, "Done this month"],
  ];
  const statusChips = [["active", "Open"], ["pending", "Awaiting reply"], ["confirmed", "Accepted"], ["completed", "Done"], ["cancelled", "Declined"], ["all", "All"]];
  const whenChips = [["upcoming", "Upcoming"], ["past", "Past"], ["all", "Any date"]];
  const chips = (list, key) => el("div", { class: "chips", role: "group" }, ...list.map(([k, n]) => el("button", { class: "chip", "aria-pressed": String(F[key] === k), onclick: () => { F[key] = k; viewBookings(); } }, n)));

  let rows = S.bookings.filter(b =>
    (F.status === "all" || (F.status === "active" ? b.status === "pending" || b.status === "confirmed" : b.status === F.status)) &&
    (F.when === "all" || (F.when === "upcoming" ? b.booking_date >= now.date : b.booking_date < now.date)) &&
    (F.barber === "all" || (F.barber === "none" ? !b.barber_id : b.barber_id === F.barber)));
  if (F.when === "past") rows = rows.slice().reverse();

  const tb = el("tbody"); let last = "";
  for (const b of rows) {
    if (b.booking_date !== last) { last = b.booking_date; tb.append(el("tr", { class: "daterow" }, el("td", { colspan: MODE === "owner" ? 6 : 5 }, prettyDate(b.booking_date, { year: true }) + (b.booking_date === now.date ? " · today" : "")))); }
    const dur = b.service?.duration || 30;
    tb.append(el("tr", {},
      el("td", {}, b.booking_time, el("div", { class: "muted", style: "font-size:12px" }, dur + " min")),
      el("td", {}, el("div", { style: "font-weight:600" }, b.customer_name), el("div", {}, el("a", { href: "tel:" + (b.customer_phone || "").replace(/\s/g, "") }, b.customer_phone)), el("div", { class: "muted" }, b.customer_email)),
      el("td", {}, b.service?.name || "Service removed", el("div", { class: "muted" }, gbp(b.service?.price)), b.notes ? el("div", { class: "muted", style: "font-style:italic" }, "“" + b.notes + "”") : null),
      MODE === "owner" ? el("td", {}, b.barber?.name || el("span", { class: "muted" }, "Any barber")) : null,
      el("td", {}, el("span", { class: "pill " + b.status }, STATUS_LABEL[b.status] || b.status)),
      el("td", {}, bookingActions(b, viewBookings))));
  }
  const barberSel = MODE === "owner" ? el("select", { id: "fb", onchange: e => { F.barber = e.target.value; viewBookings(); } },
    el("option", { value: "all", selected: F.barber === "all" }, "Everyone"), ...S.barbers.map(x => el("option", { value: x.id, selected: F.barber === x.id }, x.name)), el("option", { value: "none", selected: F.barber === "none" }, "No barber chosen")) : null;

  main(
    head(MODE === "owner" ? "Bookings" : "My bookings", "Accept or decline new requests. The customer gets an email either way. All times are UK time."),
    el("div", { class: "stats" }, ...stats.map(([n, l]) => el("div", { class: "stat" }, el("b", {}, n), el("span", {}, l)))),
    el("div", { class: "toolbar" }, chips(statusChips, "status"), el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:center" }, chips(whenChips, "when"), barberSel ? el("div", { class: "field", style: "min-width:160px" }, barberSel) : null,
      el("button", { class: "btn sm ghost", onclick: async () => { await loadBookings(); viewBookings(); toast("Bookings refreshed"); } }, "Refresh"))),
    rows.length ? el("div", { class: "tbl-wrap" }, el("table", { class: "bk" },
      el("thead", {}, el("tr", {}, ...["Time", "Customer", "Service", MODE === "owner" ? "Barber" : null, "Status", ""].filter(x => x !== null).map(h => el("th", {}, h)))), tb))
      : el("p", { class: "empty" }, "No bookings match these filters."));
}

/* ======================= calendar ======================= */
function viewCalendar() {
  const C = S.cal, now = shopNow();
  const [y, m] = C.month.split("-").map(Number);
  const first = `${C.month}-01`, startDow = (dayOfWeek(first) + 6) % 7; // Monday first
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mine = S.bookings.filter(b => b.status !== "cancelled" && (MODE === "staff" || C.barber === "all" || b.barber_id === C.barber));
  const byDay = {};
  for (const b of mine) (byDay[b.booking_date] ||= []).push(b);

  const grid = el("div", { class: "cal" }, ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => el("div", { class: "dow" }, d)));
  const cells = Math.ceil((startDow + daysIn) / 7) * 7;
  for (let i = 0; i < cells; i++) {
    const date = addDays(first, i - startDow), inMonth = date.slice(0, 7) === C.month;
    const list = byDay[date] || [], done = list.filter(b => b.status === "completed"), open = list.filter(b => b.status === "pending" || b.status === "confirmed");
    const takings = done.reduce((a, b) => a + Number(b.service?.price || 0), 0);
    grid.append(el("button", { class: "d" + (inMonth ? "" : " out") + (date === now.date ? " today" : ""), "aria-pressed": String(C.day === date),
      "aria-label": `${prettyDate(date)}: ${done.length} done, ${open.length} booked`, onclick: () => { C.day = date; viewCalendar(); } },
      el("span", { class: "n" }, String(Number(date.slice(8)))),
      done.length ? el("span", { class: "c" }, done.length, el("small", {}, gbp(takings))) : null,
      open.length ? el("span", { class: "u" }, open.length + " booked") : null));
  }
  const monthDone = mine.filter(b => b.booking_date.startsWith(C.month) && b.status === "completed");
  const monthTakings = monthDone.reduce((a, b) => a + Number(b.service?.price || 0), 0);
  const counts = {}; monthDone.forEach(b => { const n = b.service?.name || "Other"; counts[n] = (counts[n] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n} (${c})`).join(", ");
  const shift = n => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); C.month = d.toISOString().slice(0, 7); C.day = null; viewCalendar(); };

  const dayBox = C.day ? (() => {
    const list = (byDay[C.day] || []).slice().sort((a, b) => a.booking_time.localeCompare(b.booking_time));
    return el("div", { class: "card" }, el("h2", {}, prettyDate(C.day, { year: true })),
      list.length ? el("div", { class: "daylist" }, ...list.map(b => el("div", { class: "it" },
        el("span", {}, b.booking_time, " ", el("span", { class: "pill " + b.status }, STATUS_LABEL[b.status])),
        el("span", {}, el("b", {}, b.service?.name || "Service"), " · " + b.customer_name + (MODE === "owner" ? " · " + (b.barber?.name || "Any barber") : "")),
        el("span", {}, gbp(b.service?.price))))) : el("p", { class: "empty" }, "Nothing on this day."));
  })() : null;

  main(
    head(MODE === "owner" ? "Calendar" : "My calendar", "Each day shows the services done (marked Done) and what's still booked."),
    el("div", { class: "card" },
      el("div", { class: "cal-head" },
        el("div", { style: "display:flex;align-items:center;gap:8px" }, el("button", { class: "x", "aria-label": "Previous month", onclick: () => shift(-1) }, "‹"), el("h2", {}, MONTHS[m - 1] + " " + y), el("button", { class: "x", "aria-label": "Next month", onclick: () => shift(1) }, "›"),
          el("button", { class: "btn sm ghost", onclick: () => { C.month = now.date.slice(0, 7); C.day = now.date; viewCalendar(); } }, "Today")),
        MODE === "owner" ? el("div", { class: "chips", role: "group", "aria-label": "Show calendar for" }, ...[["all", "Everyone"], ...S.barbers.map(b => [b.id, b.name])].map(([k, n]) => el("button", { class: "chip", "aria-pressed": String(C.barber === k), onclick: () => { C.barber = k; viewCalendar(); } }, n))) : null),
      el("div", { class: "cal-key" }, el("span", {}, el("b", {}, monthDone.length), monthDone.length === 1 ? " service done this month" : " services done this month"), el("span", {}, el("b", {}, gbp(monthTakings)), " takings"), top ? el("span", {}, "Most popular: " + top) : null, el("span", {}, el("i", {}, "Green"), " = still booked")),
      grid),
    dayBox);
}

/* ======================= services ======================= */
function viewServices() {
  const list = el("div", { style: "display:grid;gap:10px" });
  const row = s => {
    const v = { ...s };
    const ids = { n: nid(), c: nid(), p: nid(), d: nid(), ds: nid() };
    const msg = el("span", { class: "muted", style: "font-size:13px" });
    const r = el("div", { class: "erow" },
      el("div", { class: "erow svc", style: "padding:0;border:0" },
        field("Name", el("input", { id: ids.n, value: v.name || "", oninput: e => (v.name = e.target.value) })),
        field("Category", el("input", { id: ids.c, value: v.category || "", list: "cats", oninput: e => (v.category = e.target.value) })),
        field("Price (£)", el("input", { id: ids.p, type: "number", min: "0", step: "0.5", value: v.price ?? "", oninput: e => (v.price = e.target.value) })),
        field("Minutes", el("input", { id: ids.d, type: "number", min: "5", step: "5", value: v.duration ?? "", oninput: e => (v.duration = e.target.value) })),
        el("label", { class: "check" }, el("input", { type: "checkbox", checked: v.active !== false, onchange: e => (v.active = e.target.checked) }), "Shown on site")),
      field("Description", el("input", { id: ids.ds, value: v.description || "", oninput: e => (v.description = e.target.value) })),
      el("div", { class: "toolbar" }, msg, el("div", { class: "actions" },
        el("button", { class: "btn sm", onclick: async () => {
          if (!v.name?.trim() || !(Number(v.duration) > 0)) { msg.textContent = "Give the service a name and a length in minutes."; return; }
          const data = { name: v.name.trim(), category: (v.category || "Other").trim(), price: Number(v.price) || 0, duration: Number(v.duration), description: v.description || "", active: v.active !== false, sort_order: v.sort_order ?? S.services.length };
          const res = v.id ? await sb.from("services").update(data).eq("id", v.id).select().single() : await sb.from("services").insert(data).select().single();
          if (res.error) { msg.textContent = "Couldn't save: " + res.error.message; return; }
          S.services = v.id ? S.services.map(x => (x.id === v.id ? res.data : x)) : [...S.services, res.data];
          toast("Service saved"); viewServices();
        } }, "Save"),
        v.id ? el("button", { class: "btn sm danger", onclick: async e => {
          const box = e.target.parentElement;
          box.replaceChildren(el("span", { class: "inline-confirm" }, "Delete this service?", el("button", { class: "btn sm danger", onclick: async () => {
            const { error } = await sb.from("services").delete().eq("id", v.id);
            if (error) { toast("It has bookings, so it can't be deleted. Untick “Shown on site” to hide it instead.", "err"); return viewServices(); }
            S.services = S.services.filter(x => x.id !== v.id); toast("Service deleted"); viewServices();
          } }, "Delete"), el("button", { class: "btn sm ghost", onclick: viewServices }, "Keep")));
        } }, "Delete") : el("button", { class: "btn sm ghost", onclick: viewServices }, "Cancel"))));
    return r;
  };
  for (const s of S.services) list.append(row(s));
  main(head("Services", "Change names, prices and times, add new services, or hide ones you don't offer."),
    el("datalist", { id: "cats" }, ...[...new Set(S.services.map(s => s.category).filter(Boolean))].map(c => el("option", { value: c }))),
    el("div", {}, el("button", { class: "btn", onclick: () => { list.prepend(row({ active: true, category: "Hair", duration: 30, price: 0 })); list.querySelector("input")?.focus(); } }, "Add a service")),
    list);
}

/* ======================= image picker ======================= */
function imagePicker(label, url, folder, onChange) {
  const img = el("img", { src: url || "", alt: "" });
  const urlIn = el("input", { id: nid(), type: "url", value: url || "", placeholder: "https://…", oninput: e => { img.src = e.target.value; onChange(e.target.value); } });
  const status = el("span", { class: "muted", style: "font-size:13px" });
  const file = el("input", { type: "file", accept: "image/*", onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    status.textContent = "Uploading…";
    try { const u = await uploadImage(f, folder); urlIn.value = u; img.src = u; onChange(u); status.textContent = "Uploaded. Remember to save."; }
    catch (err) { status.textContent = err.message; }
  } });
  return el("div", { class: "field" }, el("label", { for: urlIn.id }, label),
    el("div", { class: "imgpick" }, img, el("div", { style: "display:grid;gap:8px" },
      el("span", { class: "btn sm ghost file-btn" }, "Upload a photo", file), urlIn, status)));
}

/* ======================= barbers ======================= */
function viewBarbers() {
  const list = el("div", { style: "display:grid;gap:12px" });
  const card = b => {
    const v = { ...b }; const msg = el("span", { class: "muted", style: "font-size:13px" });
    return el("div", { class: "card" },
      el("div", { class: "grid2" }, field("Name", el("input", { id: nid(), value: v.name || "", oninput: e => (v.name = e.target.value) })),
        field("Title", el("input", { id: nid(), value: v.title || "", placeholder: "Senior Barber", oninput: e => (v.title = e.target.value) }))),
      field("Bio", el("textarea", { id: nid(), rows: "3", oninput: e => (v.bio = e.target.value) }, v.bio || "")),
      imagePicker("Photo", v.photo, "barbers", u => (v.photo = u)),
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: v.active !== false, onchange: e => (v.active = e.target.checked) }), "Shown on site and bookable"),
      el("div", { class: "toolbar" }, msg, el("div", { class: "actions" },
        el("button", { class: "btn sm", onclick: async () => {
          if (!v.name?.trim()) { msg.textContent = "Add a name."; return; }
          const data = { name: v.name.trim(), title: v.title || "", bio: v.bio || "", photo: v.photo || "", active: v.active !== false, sort_order: v.sort_order ?? S.barbers.length };
          const res = v.id ? await sb.from("barbers").update(data).eq("id", v.id).select().single() : await sb.from("barbers").insert(data).select().single();
          if (res.error) { msg.textContent = "Couldn't save: " + res.error.message; return; }
          S.barbers = v.id ? S.barbers.map(x => (x.id === v.id ? res.data : x)) : [...S.barbers, res.data]; toast("Barber saved"); viewBarbers();
        } }, "Save"),
        v.id ? el("button", { class: "btn sm danger", onclick: e => {
          e.target.parentElement.replaceChildren(el("span", { class: "inline-confirm" }, "Remove " + (v.name || "this barber") + "?", el("button", { class: "btn sm danger", onclick: async () => {
            const { error } = await sb.from("barbers").delete().eq("id", v.id);
            if (error) { toast("They have bookings, so they can't be removed. Untick “Shown on site” instead.", "err"); return viewBarbers(); }
            S.barbers = S.barbers.filter(x => x.id !== v.id); toast("Barber removed"); viewBarbers();
          } }, "Remove"), el("button", { class: "btn sm ghost", onclick: viewBarbers }, "Keep")));
        } }, "Remove") : el("button", { class: "btn sm ghost", onclick: viewBarbers }, "Cancel"))));
  };
  S.barbers.forEach(b => list.append(card(b)));
  main(head("Barbers", "Names, titles, bios and photos shown on the website and in booking."),
    el("div", {}, el("button", { class: "btn", onclick: () => list.prepend(card({ active: true })) }, "Add a barber")), list);
}

/* ======================= photos ======================= */
function viewPhotos() {
  const grid = el("div", { class: "thumbs" });
  const save = async (p, patch) => { const { error } = await sb.from("photos").update(patch).eq("id", p.id); if (error) toast("Couldn't save: " + error.message, "err"); else { Object.assign(p, patch); toast("Saved"); } };
  const move = async (i, d) => {
    const a = S.photos[i], b = S.photos[i + d]; if (!a || !b) return;
    const sa = a.sort_order ?? i, sbb = b.sort_order ?? i + d;
    await Promise.all([sb.from("photos").update({ sort_order: sbb === sa ? i + d : sbb }).eq("id", a.id), sb.from("photos").update({ sort_order: sa }).eq("id", b.id)]);
    a.sort_order = sbb === sa ? i + d : sbb; b.sort_order = sa; S.photos.sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0)); viewPhotos();
  };
  S.photos.forEach((p, i) => {
    const cap = el("input", { id: nid(), value: p.caption || "", placeholder: "Caption", onchange: e => save(p, { caption: e.target.value }) });
    const repl = el("input", { type: "file", accept: "image/*", onchange: async e => {
      const f = e.target.files[0]; if (!f) return; toast("Uploading…");
      try { const u = await uploadImage(f, "gallery"); await save(p, { url: u }); viewPhotos(); } catch (err) { toast(err.message, "err"); }
    } });
    const acts = el("div", { class: "actions" },
      el("button", { class: "btn sm ghost", disabled: i === 0, "aria-label": "Move earlier", onclick: () => move(i, -1) }, "↑"),
      el("button", { class: "btn sm ghost", disabled: i === S.photos.length - 1, "aria-label": "Move later", onclick: () => move(i, 1) }, "↓"),
      el("span", { class: "btn sm ghost file-btn" }, "Replace", repl),
      el("button", { class: "btn sm danger", onclick: () => acts.replaceChildren(el("span", { class: "inline-confirm" }, "Delete?",
        el("button", { class: "btn sm danger", onclick: async () => { const { error } = await sb.from("photos").delete().eq("id", p.id); if (error) return toast("Couldn't delete: " + error.message, "err"); S.photos = S.photos.filter(x => x.id !== p.id); toast("Photo deleted"); viewPhotos(); } }, "Delete"),
        el("button", { class: "btn sm ghost", onclick: viewPhotos }, "Keep"))) }, "Delete"));
    grid.append(el("div", { class: "thumb" }, el("img", { src: p.url, alt: p.caption || "" }), el("div", { class: "in" }, cap,
      el("select", { "aria-label": "Category", onchange: e => save(p, { category: e.target.value }) }, ...["Our Work", "Interior"].map(c => el("option", { selected: p.category === c }, c))), acts)));
  });
  const add = el("input", { type: "file", accept: "image/*", multiple: true, onchange: async e => {
    const files = [...e.target.files]; if (!files.length) return;
    for (const f of files) {
      toast("Uploading " + f.name + "…");
      try {
        const url = await uploadImage(f, "gallery");
        const { data, error } = await sb.from("photos").insert({ url, caption: "", category: "Our Work", sort_order: (S.photos.at(-1)?.sort_order ?? 0) + 1 }).select().single();
        if (error) throw new Error(error.message);
        S.photos.push(data);
      } catch (err) { toast(err.message, "err"); }
    }
    viewPhotos();
  } });
  const urlIn = el("input", { id: nid(), type: "url", placeholder: "Or paste an image link" });
  main(head("Photos", "The gallery on the website. Upload, replace, reorder, caption or delete."),
    el("div", { class: "card" }, el("div", { class: "toolbar" }, el("span", { class: "btn file-btn" }, "Upload photos", add),
      el("div", { style: "display:flex;gap:8px;flex:1;min-width:240px" }, el("div", { class: "field", style: "flex:1" }, urlIn), el("button", { class: "btn sm ghost", onclick: async () => {
        const url = urlIn.value.trim(); if (!/^https?:\/\//.test(url)) return toast("Paste a full link starting with https://", "err");
        const { data, error } = await sb.from("photos").insert({ url, caption: "", category: "Our Work", sort_order: (S.photos.at(-1)?.sort_order ?? 0) + 1 }).select().single();
        if (error) return toast("Couldn't add: " + error.message, "err"); S.photos.push(data); viewPhotos();
      } }, "Add link")))),
    S.photos.length ? grid : el("p", { class: "empty" }, "No photos yet."),
    el("p", { class: "muted", style: "font-size:13px" }, "The hero photo at the top of the website and the barbers' photos are changed under Shop details and Barbers."));
}

/* ======================= shop details ======================= */
function viewDetails() {
  const v = { ...S.settings }; const msg = el("p", { class: "muted" });
  const inp = (k, label, type = "text", extra = {}) => field(label, el("input", { id: nid(), type, value: v[k] ?? "", oninput: e => (v[k] = e.target.value), ...extra }));
  const hours = el("div", { style: "display:grid;gap:8px" }, ...[1, 2, 3, 4, 5, 6, 0].map(d => {
    const k = DAY_KEYS[d]; const closed = !hhmm(v[k + "_open"]);
    const o = el("input", { type: "time", "aria-label": DAY_NAMES[d] + " opens", value: hhmm(v[k + "_open"]) || "09:00", disabled: closed, oninput: e => (v[k + "_open"] = e.target.value) });
    const c = el("input", { type: "time", "aria-label": DAY_NAMES[d] + " closes", value: hhmm(v[k + "_close"]) || "18:30", disabled: closed, oninput: e => (v[k + "_close"] = e.target.value) });
    return el("div", { style: "display:grid;grid-template-columns:110px 1fr 1fr auto;gap:8px;align-items:center" }, el("span", {}, DAY_NAMES[d]),
      el("div", { class: "field" }, o), el("div", { class: "field" }, c),
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: closed, onchange: e => {
        o.disabled = c.disabled = e.target.checked;
        if (e.target.checked) { v[k + "_open"] = ""; v[k + "_close"] = ""; } else { v[k + "_open"] = o.value; v[k + "_close"] = c.value; }
      } }), "Closed"));
  }));
  main(head("Shop details", "Everything here shows on the website. Changes appear as soon as you save."),
    el("div", { class: "card" }, el("h2", {}, "The basics"),
      el("div", { class: "grid2" }, inp("name", "Shop name"), inp("tagline", "Tagline")),
      field("About the shop", el("textarea", { id: nid(), rows: "4", oninput: e => (v.about = e.target.value) }, v.about || "")),
      imagePicker("Main photo at the top of the website", v.hero_image, "hero", u => (v.hero_image = u))),
    el("div", { class: "card" }, el("h2", {}, "Contact"),
      el("div", { class: "grid2" }, inp("address", "Address"), inp("phone", "Phone", "tel")),
      inp("shop_email", "Shop email (gets a copy of every booking)", "email"),
      el("div", { class: "grid3" }, inp("instagram", "Instagram link", "url"), inp("facebook", "Facebook link", "url"), inp("tiktok", "TikTok link", "url"))),
    el("div", { class: "card" }, el("h2", {}, "Opening hours (UK time)"), el("p", { class: "muted", style: "font-size:14px" }, "Online booking only offers times inside these hours."), hours,
      inp("opening_hours", "Short summary shown at the top of the site", "text", { placeholder: "Open Monday–Saturday · Closes 6:30 pm" })),
    el("div", { class: "card" }, el("h2", {}, "Google rating"), el("div", { class: "grid2" }, inp("rating", "Rating", "number", { step: "0.1", min: "0", max: "5" }), inp("review_count", "Number of reviews", "number", { min: "0" }))),
    el("div", { class: "toolbar" }, msg, el("button", { class: "btn", onclick: async () => {
      const patch = { ...v }; delete patch.id; delete patch.admin_code;
      patch.rating = Number(patch.rating) || 0; patch.review_count = parseInt(patch.review_count) || 0;
      const { error } = await sb.from("shop_settings").update(patch).eq("id", 1);
      if (error) { msg.textContent = "Couldn't save: " + error.message; return; }
      S.settings = { ...S.settings, ...patch }; toast("Shop details saved");
    } }, "Save shop details")));
}

/* ======================= passwords & staff ======================= */
function passwordCard() {
  const v = { cur: "", a: "", b: "" }; const msg = el("p", { class: "err" });
  return el("div", { class: "card" }, el("h2", {}, "Your password"), el("p", { class: "muted" }, "Signed in as " + S.me.email),
    el("div", { class: "grid3" },
      field("Current password", el("input", { id: nid(), type: "password", autocomplete: "current-password", oninput: e => (v.cur = e.target.value) })),
      field("New password", el("input", { id: nid(), type: "password", autocomplete: "new-password", oninput: e => (v.a = e.target.value) })),
      field("Repeat new password", el("input", { id: nid(), type: "password", autocomplete: "new-password", oninput: e => (v.b = e.target.value) }))),
    msg, el("div", {}, el("button", { class: "btn", onclick: async () => {
      msg.className = "err"; msg.textContent = "";
      if (v.a.length < 8 || v.a !== v.b) { msg.textContent = "Use at least 8 characters, and type the new password the same way twice."; return; }
      const chk = await sb.auth.signInWithPassword({ email: S.me.email, password: v.cur });
      if (chk.error) { msg.textContent = "Your current password isn't right."; return; }
      const { error } = await sb.auth.updateUser({ password: v.a });
      if (error) { msg.textContent = "The password couldn't be changed: " + error.message; return; }
      msg.className = "ok-msg"; msg.textContent = "Password changed."; toast("Password changed");
    } }, "Change password")));
}
function viewAccess() {
  if (MODE === "staff") return main(head("My password", "Change the password you use to sign in."), passwordCard());

  const staff = S.admins.filter(a => a.role !== "owner");
  const call = async body => {
    const { data, error } = await sb.functions.invoke("create-staff", { body });
    if (error) return error.message || "Something went wrong.";
    if (data?.error) return data.error;
    return null;
  };
  const barberSelect = (val, onChange) => el("select", { id: nid(), onchange: e => onChange(e.target.value) }, el("option", { value: "" }, "Choose a barber"),
    ...S.barbers.map(b => el("option", { value: b.id, selected: b.id === val }, b.name)));

  const staffRow = a => {
    const v = { email: a.email, pw: "", pw2: "", barber: a.barber_id || "" }; const msg = el("p", { class: "err" });
    return el("div", { class: "erow" },
      el("div", { class: "toolbar" }, el("b", {}, (a.barber?.name || "Not linked") + " · " + a.email)),
      el("div", { class: "grid2" },
        field("Login email", el("input", { id: nid(), type: "email", value: v.email, oninput: e => (v.email = e.target.value) })),
        field("Barber", barberSelect(v.barber, x => (v.barber = x)))),
      el("div", { class: "grid2" },
        field("New password (leave blank to keep)", el("input", { id: nid(), type: "password", autocomplete: "new-password", oninput: e => (v.pw = e.target.value) })),
        field("Repeat new password", el("input", { id: nid(), type: "password", autocomplete: "new-password", oninput: e => (v.pw2 = e.target.value) }))),
      msg, el("div", {}, el("button", { class: "btn sm", onclick: async () => {
        msg.className = "err"; msg.textContent = "";
        if (!v.email.includes("@")) { msg.textContent = "Enter a valid email."; return; }
        if (v.pw && (v.pw.length < 8 || v.pw !== v.pw2)) { msg.textContent = "Use at least 8 characters, and type the new password the same way twice."; return; }
        const e = await call({ action: "update", user_id: a.user_id, email: v.email.trim().toLowerCase(), password: v.pw, barber_id: v.barber });
        if (e) { msg.textContent = e; return; }
        await loadAdmins(); toast("Staff login updated"); viewAccess();
      } }, "Save changes")));
  };

  const n = { email: "", pw: "", barber: "" }; const nmsg = el("p", { class: "err" });
  const ownerEmail = { v: S.me.email }; const omsg = el("p", { class: "err" });
  main(head("Passwords & staff", "Change your own password, and create or change your staff's logins and passwords."),
    passwordCard(),
    el("div", { class: "card" }, el("h2", {}, "Your login email"),
      el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:end" }, el("div", { class: "field", style: "flex:1;min-width:220px" }, el("input", { type: "email", "aria-label": "Login email", value: ownerEmail.v, oninput: e => (ownerEmail.v = e.target.value) })),
        el("button", { class: "btn sm", onclick: async () => {
          omsg.className = "err"; omsg.textContent = "";
          if (!ownerEmail.v.includes("@")) { omsg.textContent = "Enter a valid email."; return; }
          const e = await call({ action: "update", user_id: S.me.user_id, email: ownerEmail.v.trim().toLowerCase(), barber_id: S.me.barber_id });
          if (e) { omsg.textContent = e; return; }
          S.me.email = ownerEmail.v.trim().toLowerCase(); omsg.className = "ok-msg"; omsg.textContent = "Login email updated.";
        } }, "Save email")), omsg),
    el("div", { class: "card" }, el("h2", {}, "Staff logins"),
      el("p", { class: "muted", style: "font-size:14px" }, "Each barber signs in at the staff login page and only sees their own bookings and calendar."),
      staff.length ? el("div", { style: "display:grid;gap:10px" }, ...staff.map(staffRow)) : el("p", { class: "empty" }, "No staff logins yet."),
      el("h2", { style: "font-size:18px;margin-top:8px" }, "Add a staff login"),
      el("div", { class: "grid3" },
        field("Email", el("input", { id: nid(), type: "email", oninput: e => (n.email = e.target.value) })),
        field("Password (8+ characters)", el("input", { id: nid(), type: "password", autocomplete: "new-password", oninput: e => (n.pw = e.target.value) })),
        field("Barber", barberSelect("", x => (n.barber = x)))),
      nmsg, el("div", {}, el("button", { class: "btn", onclick: async () => {
        nmsg.textContent = "";
        if (!n.email.includes("@") || n.pw.length < 8 || !n.barber) { nmsg.textContent = "Enter an email, a password of at least 8 characters, and choose the barber."; return; }
        const e = await call({ email: n.email.trim().toLowerCase(), password: n.pw, barber_id: n.barber });
        if (e) { nmsg.textContent = e; return; }
        await loadAdmins(); toast("Staff login created. Share the email and password with them."); viewAccess();
      } }, "Create staff login"))));
}

/* ======================= start ======================= */
sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") loginScreen(); });
setInterval(async () => { if (S.me && S.view === "bookings" && document.visibilityState === "visible") { const before = S.bookings.length; await loadBookings(); if (S.bookings.length !== before) { shell(); } } }, 60000);
boot();
