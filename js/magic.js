/* magic.js — tiny helpers for magic.css effects that need JS.
   All effects are opt-in via data attributes.

     data-magic-ticker="1247"           Count up 0 → N when scrolled into view
     data-magic-ticker-suffix="+"       Optional suffix
     data-magic-ticker-prefix="$"       Optional prefix
     data-magic-ticker-duration="1600"  Ms to animate (default 1500)

     data-magic-reveal                  Fade + rise into view on scroll
     data-magic-reveal-delay="120"      Ms delay after entering view
*/
(function () {
  "use strict";
  var REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function fmt(n) { return Math.round(n).toLocaleString(); }

  function animateTicker(el) {
    var target = parseFloat(el.getAttribute("data-magic-ticker")) || 0;
    var prefix = el.getAttribute("data-magic-ticker-prefix") || "";
    var suffix = el.getAttribute("data-magic-ticker-suffix") || "";
    var duration = parseInt(el.getAttribute("data-magic-ticker-duration") || "1500", 10);
    if (REDUCE) { el.textContent = prefix + fmt(target) + suffix; return; }
    var start = performance.now();
    function tick(now) {
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = prefix + fmt(target * eased) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function initTickers() {
    var els = document.querySelectorAll("[data-magic-ticker]");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) { els.forEach(animateTicker); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { animateTicker(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.35 });
    els.forEach(function (el) { el.textContent = "0"; io.observe(el); });
  }

  function initReveals() {
    var els = document.querySelectorAll("[data-magic-reveal]");
    if (!els.length) return;
    els.forEach(function (el) {
      el.style.opacity = "0";
      el.style.transform = "translateY(12px)";
      el.style.transition = "opacity .55s ease, transform .55s cubic-bezier(.2,.9,.3,1)";
    });
    if (REDUCE || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.style.opacity = "1"; el.style.transform = "none"; });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var delay = parseInt(e.target.getAttribute("data-magic-reveal-delay") || "0", 10);
        setTimeout(function () { e.target.style.opacity = "1"; e.target.style.transform = "none"; }, delay);
        io.unobserve(e.target);
      });
    }, { threshold: 0.15 });
    els.forEach(function (el) { io.observe(el); });
  }

  function boot() { initTickers(); initReveals(); }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); } else { boot(); }
})();
