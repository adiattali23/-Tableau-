// ORÉ — site behaviour (mobile menu, gentle reveal, newsletter placeholder)
(function () {
  "use strict";
  document.documentElement.classList.add("js");

  // ----- Mobile navigation drawer -----
  var nav = document.getElementById("main-nav");
  var openBtn = document.getElementById("nav-open");
  var closeBtn = document.getElementById("nav-close");
  var scrim = document.getElementById("nav-scrim");

  function setNav(open) {
    if (!nav) return;
    nav.classList.toggle("is-open", open);
    if (scrim) scrim.classList.toggle("is-open", open);
    if (openBtn) openBtn.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
    if (open) {
      var first = nav.querySelector("a");
      if (first) first.focus();
    } else if (openBtn) {
      openBtn.focus();
    }
  }

  if (openBtn) openBtn.addEventListener("click", function () { setNav(true); });
  if (closeBtn) closeBtn.addEventListener("click", function () { setNav(false); });
  if (scrim) scrim.addEventListener("click", function () { setNav(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && nav && nav.classList.contains("is-open")) setNav(false);
  });

  // ----- Announcement bar: pause / play (WCAG 2.2.2) -----
  var annBtn = document.getElementById("announce-toggle");
  if (annBtn) {
    annBtn.addEventListener("click", function () {
      var bar = annBtn.closest(".announce");
      var paused = bar.classList.toggle("is-paused");
      document.documentElement.classList.toggle("marquee-paused", paused);
      annBtn.setAttribute("aria-pressed", String(paused));
      annBtn.querySelector(".visually-hidden").textContent = paused ? "הפעלת ההודעות הנעות" : "עצירת ההודעות הנעות";
    });
  }

  // ----- Reveal on scroll -----
  var items = document.querySelectorAll(".reveal");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("IntersectionObserver" in window) || reduce) {
    items.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach(function (el) {
      // anything already on screen at load shows immediately
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight) el.classList.add("is-visible");
      else io.observe(el);
    });
  }

  // ----- Newsletter (will be connected to the mailing service in a later stage) -----
  var form = document.getElementById("newsletter-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = form.querySelector("input[type=email]");
      var status = document.getElementById("newsletter-status");
      if (!input.checkValidity()) {
        status.textContent = "נראה שכתובת המייל לא מלאה. בדקי ונסי שוב.";
        input.focus();
        return;
      }
      status.textContent = "תודה! נרשמת לרשימה. (בטיוטה זו ההרשמה עוד לא נשמרת.)";
      form.reset();
    });
  }

  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
