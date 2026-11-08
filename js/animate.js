// Scroll animations for the public website. Visual only: it adds classes and
// a stagger number; it never touches bookings, admin or data.
(function () {
  if (!("IntersectionObserver" in window)) return;               // old browser: everything just shows
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const targets = document.querySelectorAll(
    ".about .wrap > *, .svc-head, #board, #team .wrap > *, #gallery .wrap > *, #reviews .wrap > *, .visit .wrap:not(.map-wrap) > *, .map-wrap"
  );
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  targets.forEach(t => { t.classList.add("rv"); io.observe(t); });

  // Safety net: never leave anything hidden (e.g. jumping straight to a section).
  setTimeout(() => targets.forEach(t => t.classList.add("in")), 6000);

  // Number the items inside lists as they're loaded, so they arrive one after another.
  const number = list => {
    [...list.children].forEach((c, i) => c.style.setProperty("--i", Math.min(i, 12)));
    list.querySelectorAll(".row").forEach((r, i) => r.style.setProperty("--i", i % 8));
  };
  ["#board", "#teamGrid", "#gal", "#revs"].forEach(sel => {
    const list = document.querySelector(sel);
    if (!list) return;
    number(list);
    new MutationObserver(() => number(list)).observe(list, { childList: true, subtree: true });
  });
})();
