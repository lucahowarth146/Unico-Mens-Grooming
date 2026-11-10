import { sb, $, el, toast, gbp, sharp, sharpAttrs, shopNow, addDays, dayOfWeek, hoursFor, prettyDate, fmtTime, hhmm, DAY_NAMES, MONTHS,
  fetchBusy, freeBarbers, availableTimes, loadPublic, notify, uuid } from "./lib.js";
import { BOOKING_DAYS_AHEAD } from "./config.js";

const REVIEWS = [
  ["Tom W.", "Best barbers in Sale, hands down. Cam's attention to detail is incredible. I won't go anywhere else."],
  ["Daniel K.", "Walked in for a skin fade and walked out feeling like a million quid. Clean shop, great music, top blokes."],
  ["Alex M.", "Booked the Groom Package for my wedding. Hot towel shave was spot on. Highly recommend Unico."],
  ["Chris B.", "Took my son for his first proper haircut. Patient, friendly, and the result was perfect. Thank you!"],
  ["Sam R.", "I've tried every barbers in the area. Unico is the only one that gets my fade right every single time."],
  ["Jordan L.", "Beard conditioning is a game changer. My beard has never felt softer. Great atmosphere too."],
];

let D = { settings: {}, services: [], barbers: [], photos: [] };
$("#yr").textContent = new Date().getFullYear();

/* ---------- render the public page ---------- */
function renderPage() {
  const s = D.settings;
  const hero = $("#heroImg");
  hero.onerror = () => { hero.onerror = null; hero.removeAttribute("srcset"); hero.src = "img/hero.jpg"; };
  if (s.hero_image) { const a = sharpAttrs(s.hero_image, 1600); hero.sizes = "100vw"; if (a.srcset) hero.srcset = a.srcset; hero.src = a.src; }
  else hero.src = "img/hero.jpg";
  if (s.tagline) $("#tagline").textContent = s.tagline;
  if (s.about) $("#about").textContent = s.about;
  if (s.name) { document.title = s.name + " | Barbershop in Sale"; $("#footName").textContent = s.name; }
  $("#rating").replaceChildren(el("span", { class: "stars", "aria-hidden": "true" }, "★★★★★"), " ", el("b", {}, Number(s.rating || 5).toFixed(1)), ` from ${s.review_count || 0} Google reviews`);

  // services price board
  const cats = [...new Set(D.services.map(x => x.category || "Other"))];
  $("#board").replaceChildren(...cats.map(c => el("div", { class: "cat" }, el("h3", {}, c),
    ...D.services.filter(x => (x.category || "Other") === c).map(x => el("div", { class: "row" },
      el("span", { class: "nm" }, x.name), el("span", { class: "lead" }), el("span", { class: "pr" }, gbp(x.price)),
      el("div", { class: "ds" }, el("span", {}, x.description || ""), el("span", {}, x.duration + " min · ", el("button", { onclick: () => openBooking({ service: x.id }) }, "Book"))))))));
  if (!D.services.length) $("#board").replaceChildren(el("p", { class: "loading-veil" }, "Services will appear here soon."));

  $("#teamGrid").replaceChildren(...D.barbers.map(b => el("article", { class: "barber" },
    b.photo ? el("img", { ...sharpAttrs(b.photo, 600), sizes: "(max-width: 720px) 100vw, 560px", alt: "Barber " + b.name, loading: "lazy", onerror: e => e.target.remove() }) : null,
    el("div", { class: "in" }, el("span", { class: "role" }, b.title || "Barber"), el("h3", {}, b.name), el("p", {}, b.bio || ""),
      el("button", { class: "btn ghost", onclick: () => openBooking({ barber: b.id }) }, "Book with " + b.name)))));

  $("#gal").replaceChildren(...D.photos.map(p => el("figure", { tabindex: "0", role: "button", "aria-label": "View photo: " + (p.caption || "photo"),
    onclick: () => openLb(p.url, p.caption), onkeydown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLb(p.url, p.caption); } } },
    el("img", { ...sharpAttrs(p.url, 600), sizes: "(max-width: 640px) 100vw, 560px", alt: p.caption || "Photo from the shop", loading: "lazy", onerror: e => e.target.closest("figure")?.remove() }), p.caption ? el("figcaption", {}, p.caption) : null)));

  $("#revs").replaceChildren(...REVIEWS.map(([n, t]) => el("figure", { class: "rev", style: "margin:0" },
    el("span", { class: "stars", "aria-label": "5 out of 5" }, "★★★★★"), el("q", {}, t), el("figcaption", { class: "who" }, n))));

  // contact + map
  const addr = s.address || "";
  $("#addr").textContent = addr;
  $("#phone").textContent = s.phone || ""; $("#phone").href = "tel:" + (s.phone || "").replace(/\s/g, "");
  const soc = [["Instagram", s.instagram], ["Facebook", s.facebook], ["TikTok", s.tiktok]].filter(([, u]) => u);
  $("#socials").replaceChildren(...(soc.length ? [el("div", { class: "k" }, "Follow us"), el("div", { style: "display:flex;gap:16px;flex-wrap:wrap" }, ...soc.map(([n, u]) => el("a", { class: "v", href: u, target: "_blank", rel: "noopener" }, n)))] : []));
  const q = encodeURIComponent((s.name || "Unico Men's Grooming") + ", " + addr);
  $("#map").src = `https://maps.google.com/maps?q=${q}&z=16&output=embed`;
  $("#directions").href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;
  $("#mapCaption").textContent = addr;

  // opening hours, in shop time
  const now = shopNow(), todayDow = dayOfWeek(now.date);
  const order = [1, 2, 3, 4, 5, 6, 0];
  $("#hours").replaceChildren(...order.map(d => {
    const k = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d];
    const o = hhmm(s[k + "_open"]), c = hhmm(s[k + "_close"]);
    return el("tr", { class: d === todayDow ? "today" : "" }, el("td", {}, DAY_NAMES[d] + (d === todayDow ? " · today" : "")), el("td", {}, o && c ? `${o} – ${c}` : "Closed"));
  }));
  const h = hoursFor(s, now.date);
  const open = h && now.minutes >= h.open && now.minutes < h.close;
  $("#openNow").replaceChildren(el("b", {}, open ? "Open now" : "Closed now"), s.opening_hours ? " · " + s.opening_hours : "");
}

function openLb(src, cap) { $("#lbImg").src = sharp(src, 2000); $("#lbImg").alt = cap || ""; $("#lbCap").textContent = cap || ""; $("#lb").hidden = false; $("#lbClose").focus(); }
$("#lbClose").onclick = () => ($("#lb").hidden = true);
$("#lb").onclick = e => { if (e.target.id === "lb") $("#lb").hidden = true; };
document.addEventListener("click", e => { if (e.target.closest("[data-book]")) openBooking({}); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#lb").hidden) $("#lb").hidden = true; else if (!$("#sheet").hidden) closeBooking(); } });

/* ---------- booking ---------- */
const STEPS = ["service", "barber", "time", "details", "review"];
const st = { step: "service", service: null, barber: "any", date: null, time: null, name: "", phone: "", email: "", notes: "", error: "", saving: false, busy: {}, busyOk: true, loading: false, done: null };
const svc = () => D.services.find(x => x.id === st.service);

function openBooking({ service, barber }) {
  Object.assign(st, { step: service ? "barber" : "service", service: service || null, barber: barber || "any", date: null, time: null, error: "", saving: false, done: null });
  $("#sheet").hidden = false; document.body.style.overflow = "hidden"; document.body.classList.add("modal-open"); render(); $("#closeSheet").focus();
}
function closeBooking() { $("#sheet").hidden = true; document.body.style.overflow = ""; document.body.classList.remove("modal-open"); }
$("#closeSheet").onclick = closeBooking;
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeBooking(); });
const go = s => { st.step = s; st.error = ""; render(); $("#sbody").scrollTop = 0; };

async function loadBusy(date, force) {
  if ((st.busy[date] && !force) || loadBusy.pending === date) return;
  loadBusy.pending = date;
  const r = await fetchBusy(date);
  loadBusy.pending = null;
  st.busy[date] = r.busy; st.busyOk = r.ok;
  if (!force) render();
}

function render() {
  const b = $("#sbody"), f = $("#sfoot"), idx = STEPS.indexOf(st.step);
  $("#steps").replaceChildren(...STEPS.map((_, i) => el("i", { class: i <= idx ? "on" : "" })));
  $("#steps").hidden = idx < 0;
  b.replaceChildren(); f.replaceChildren();
  const s = svc();
  const sum = el("span", { class: "sum" }, s ? [el("b", {}, gbp(s.price)), ` · ${s.duration} min`] : "Choose a service");
  const back = to => el("button", { class: "btn ghost", onclick: () => go(to) }, "Back");
  const next = (label, ok, fn) => el("button", { class: "btn", disabled: !ok, onclick: fn }, label);

  if (st.step === "service") {
    b.append(el("p", { class: "q" }, "Choose a service."));
    const ch = el("div", { class: "choice" });
    for (const c of [...new Set(D.services.map(x => x.category || "Other"))]) {
      ch.append(el("div", { class: "grp" }, c));
      for (const x of D.services.filter(y => (y.category || "Other") === c)) {
        const on = st.service === x.id;
        ch.append(el("button", { class: "opt", "aria-pressed": String(on), onclick: () => { st.service = x.id; st.time = null; render(); } },
          el("span", { class: "ck" }, on ? "✓" : ""), el("span", {}, el("div", { class: "t" }, x.name), el("div", { class: "s" }, `${x.duration} min · ${x.description || ""}`)), el("span", { class: "p" }, gbp(x.price))));
      }
    }
    b.append(ch);
    f.append(sum, el("div", { class: "btns" }, next("Next", !!s, () => go("barber"))));
  }

  if (st.step === "barber") {
    b.append(el("p", { class: "q" }, "Who would you like to see?"));
    const opts = [{ id: "any", name: "Any barber", title: "First available appointment" }, ...D.barbers];
    b.append(el("div", { class: "choice" }, ...opts.map(o => el("button", { class: "opt bopt", "aria-pressed": String(st.barber === o.id), onclick: () => { st.barber = o.id; st.time = null; render(); } },
      o.photo ? el("img", { src: sharp(o.photo, 160), alt: "" }) : el("span", { class: "av" }, "★"), el("span", {}, el("div", { class: "t" }, o.name), el("div", { class: "s" }, o.title || "")), el("span", { class: "ck" }, st.barber === o.id ? "✓" : "")))));
    f.append(sum, el("div", { class: "btns" }, back("service"), next("Next", true, () => go("time"))));
  }

  if (st.step === "time") {
    b.append(el("p", { class: "q" }, "Pick a day and time. All times are UK time."));
    const now = shopNow();
    const days = el("div", { class: "days", role: "group", "aria-label": "Day" });
    let firstOpen = null;
    for (let i = 0; i < BOOKING_DAYS_AHEAD; i++) {
      const d = addDays(now.date, i), h = hoursFor(D.settings, d);
      const usable = h && (i > 0 || now.minutes + 30 + s.duration <= h.close);
      if (usable && !firstOpen) firstOpen = d;
      const [, m, dd] = d.split("-").map(Number);
      days.append(el("button", { class: "day", "aria-pressed": "false", "data-d": d, disabled: !usable, "aria-label": prettyDate(d), onclick: () => { st.date = d; st.time = null; render(); } },
        el("small", {}, i === 0 ? "Today" : DAY_NAMES[dayOfWeek(d)].slice(0, 3)), el("b", {}, String(dd)), el("small", {}, MONTHS[m - 1].slice(0, 3))));
    }
    if (!st.date) st.date = firstOpen;
    for (const n of days.children) n.setAttribute("aria-pressed", String(n.dataset.d === st.date));
    b.append(days);
    if (!st.date) b.append(el("p", { class: "empty" }, "No days are open for booking right now. Please call us."));
    else if (!st.busy[st.date]) { b.append(el("p", { class: "empty" }, "Checking availability…")); loadBusy(st.date); }
    else {
      const ts = availableTimes({ settings: D.settings, dateStr: st.date, dur: s.duration, barbers: D.barbers, busy: st.busy[st.date], wanted: st.barber });
      b.append(el("div", { class: "grp" }, prettyDate(st.date)));
      if (!ts.length) b.append(el("p", { class: "empty" }, "No free times on this day. Try another day or another barber."));
      for (const [g, a, z] of [["Morning", 0, 720], ["Afternoon", 720, 1020], ["Evening", 1020, 1440]]) {
        const list = ts.filter(m => m >= a && m < z); if (!list.length) continue;
        b.append(el("div", { class: "q" }, g), el("div", { class: "times" }, ...list.map(m => el("button", { class: "time", "aria-pressed": String(st.time === m), onclick: () => { st.time = m; render(); } }, fmtTime(m)))));
      }
    }
    requestAnimationFrame(() => days.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "center" }));
    f.append(sum, el("div", { class: "btns" }, back("barber"), next("Next", st.time != null, () => go("details"))));
  }

  if (st.step === "details") {
    b.append(el("p", { class: "q" }, "Your details. We'll email your confirmation."));
    const fld = (id, label, type, ac) => el("div", { class: "field" }, el("label", { for: "f-" + id }, label),
      type === "textarea" ? el("textarea", { id: "f-" + id, rows: "3", oninput: e => (st[id] = e.target.value) }, st[id])
        : el("input", { id: "f-" + id, type, value: st[id], autocomplete: ac, oninput: e => (st[id] = e.target.value) }));
    b.append(fld("name", "Full name", "text", "name"), fld("email", "Email", "email", "email"), fld("phone", "Mobile number", "tel", "tel"), fld("notes", "Notes for your barber (optional)", "textarea", "off"));
    if (st.error) b.append(el("p", { class: "err" }, st.error));
    f.append(sum, el("div", { class: "btns" }, back("time"), next("Review", true, () => {
      if (st.name.trim().length < 2) { st.error = "Enter your name so we know who's coming in."; return render(); }
      if (!/^\S+@\S+\.\S+$/.test(st.email.trim())) { st.error = "Enter a valid email address. Your confirmation is sent there."; return render(); }
      if (st.phone.replace(/\D/g, "").length < 10) { st.error = "Enter a phone number with at least 10 digits."; return render(); }
      go("review");
    })));
  }

  if (st.step === "review") {
    const bn = st.barber === "any" ? "Any barber" : D.barbers.find(x => x.id === st.barber)?.name;
    b.append(el("p", { class: "q" }, "Check your booking."), el("div", { class: "review" },
      ...[["Service", s.name], ["Barber", bn], ["When", `${prettyDate(st.date)} at ${fmtTime(st.time)} (UK time)`], ["Length", s.duration + " min"], ["Name", st.name], ["Email", st.email], ["Phone", st.phone], st.notes && ["Notes", st.notes], ["Price", gbp(s.price) + ", pay in the shop"]]
        .filter(Boolean).map(([k, v]) => el("div", {}, el("span", {}, k), el("span", {}, v)))));
    b.append(el("p", { class: "note" }, "Your booking goes to the shop to accept. We'll email you when it's accepted."));
    if (st.error) b.append(el("p", { class: "err" }, st.error));
    f.append(sum, el("div", { class: "btns" }, back("details"), next(st.saving ? "Booking…" : "Confirm booking", !st.saving, confirm)));
  }

  if (st.step === "done") {
    const d = st.done;
    b.append(el("div", { class: "done" }, el("div", { class: "seal" }, "✓"), el("h3", { class: "h2", style: "font-size:30px" }, "Booking request sent"),
      el("p", { class: "lede" }, `${d.service} with ${d.barber}, ${prettyDate(d.date)} at ${d.time} (UK time).`),
      el("p", { class: "lede" }, d.emailed ? `A confirmation is on its way to ${d.email}. We'll email you again when your barber accepts.` : `We've got your booking. If no email arrives, call us on ${D.settings.phone || "the shop"}.`)));
    f.append(el("span"), el("button", { class: "btn", onclick: closeBooking }, "Done"));
  }
}

async function confirm() {
  st.saving = true; st.error = ""; render();
  const s = svc();
  // re-check the slot just before saving
  await loadBusy(st.date, true);
  const busy = st.busy[st.date];
  const free = freeBarbers(D.barbers, busy, st.time, s.duration, st.barber);
  if (st.busyOk && !free.length) {
    st.saving = false; st.time = null; go("time"); toast("Sorry, that time was just taken. Please pick another."); return;
  }
  const barberId = st.barber !== "any" ? st.barber : (st.busyOk ? free[0] : null);
  const row = {
    id: uuid(), customer_name: st.name.trim(), customer_email: st.email.trim(), customer_phone: st.phone.trim(),
    service_id: s.id, barber_id: barberId, booking_date: st.date, booking_time: fmtTime(st.time), notes: st.notes.trim(), status: "pending",
  };
  const { error } = await sb.from("bookings").insert(row);
  if (error) {
    st.saving = false;
    if (/slot_taken/i.test(error.message)) { st.busy[st.date] = null; st.time = null; go("time"); toast("Sorry, that time was just taken. Please pick another."); return; }
    if (/too_many_bookings: this/i.test(error.message)) { st.error = `You already have 3 upcoming bookings with us. Please call ${D.settings.phone || "the shop"} to book more.`; render(); return; }
    if (/too_many_bookings/i.test(error.message)) { st.error = "Lots of people are booking right now. Please try again in a few minutes."; render(); return; }
    if (/invalid_booking: (email|phone|name)/i.test(error.message)) { st.error = "Please check your name, email and phone number, then try again."; go("details"); return; }
    st.error = `The booking didn't go through. Try again, or call us on ${D.settings.phone || "the shop"}.`; render(); return;
  }
  const emailed = await notify(row.id, "created");
  st.saving = false;
  st.done = { service: s.name, barber: barberId ? D.barbers.find(x => x.id === barberId)?.name : "the first available barber", date: st.date, time: row.booking_time, email: row.customer_email, emailed };
  st.busy[st.date] = null;
  go("done");
}

/* ---------- start ---------- */
(async () => {
  D = await loadPublic();
  if (D.error) toast("Some details didn't load. Refresh the page to try again.", "err");
  renderPage();
})();
