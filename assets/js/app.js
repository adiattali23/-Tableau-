/* =====================================================================
   ORÉ — store app
   Data: data/products.json + data/settings.json (or window.ORE_DATA in
   preview builds). Cart, orders and saved details live in this browser.
   Sections: helpers · storage · cart · rendering · shared UI · pages · boot
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- helpers ---------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) {
    var v = Math.round(n * 100) / 100;
    return "₪" + (v % 1 ? v.toFixed(2) : String(v));
  }
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ICON_BAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1.2 12.5H6.2L5 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/><path d="M12 11.5v5M9.5 14h5"/></svg>';

  /* ---------- storage (always safe: private mode, blocked storage) ---------- */
  var memory = {};
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return key in memory ? memory[key] : fallback;
  }
  function save(key, value) {
    memory[key] = value;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
  var KEYS = { cart: "ore-cart-v2", orders: "ore-orders-v1", details: "ore-details-v1", intent: "ore-intent", search: "ore-search" };

  /* Where a link was heading. Some previewers drop the #part of a link when
     moving between pages, so we also remember it ourselves. */
  function routeValue(page) {
    var hash = decodeURIComponent(location.hash.slice(1));
    if (hash) return hash;
    var intent = load(KEYS.intent, null);
    if (intent && intent.page === page && Date.now() - intent.t < 60000) return intent.value;
    return "";
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var m = a.getAttribute("href").match(/^([\w-]+)\.html#(.+)$/);
    if (m) save(KEYS.intent, { page: m[1], value: decodeURIComponent(m[2]), t: Date.now() });
  }, true);

  /* ---------- data ---------- */
  var DATA = null;
  function loadData() {
    if (window.ORE_DATA) return Promise.resolve(window.ORE_DATA);
    var get = function (u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); };
    return Promise.all([get("data/products.json"), get("data/settings.json")]).then(function (r) {
      return { products: r[0].products || [], settings: r[1] };
    });
  }
  function product(id) { return DATA.products.filter(function (p) { return p.id === id; })[0]; }
  function category(id) { return DATA.settings.categories.filter(function (c) { return c.id === id; })[0]; }
  function priceOf(p, size) {
    if (p.sizes && p.sizes.length) {
      var s = p.sizes.filter(function (x) { return x.label === size; })[0];
      return s ? s.price : Math.min.apply(null, p.sizes.map(function (x) { return x.price; }));
    }
    return p.price;
  }
  function inStock(p) { return p.stock == null || p.stock > 0; }

  /* ---------- cart ---------- */
  var cart = {
    items: function () {
      return load(KEYS.cart, []).filter(function (i) { return product(i.id); }).map(function (i) {
        i.price = priceOf(product(i.id), i.size); // prices always follow the catalogue
        return i;
      });
    },
    set: function (items) { save(KEYS.cart, items); document.dispatchEvent(new CustomEvent("cart:change")); },
    add: function (p, opts, qty) {
      var items = cart.items();
      var key = [p.id, opts.size, opts.color, opts.scent].join("|");
      var hit = items.filter(function (i) { return i.key === key; })[0];
      if (hit) hit.qty = Math.min(20, hit.qty + qty);
      else items.push({ key: key, id: p.id, name: p.name, size: opts.size || "", color: opts.color || "", scent: opts.scent || "", price: priceOf(p, opts.size), qty: qty });
      cart.set(items);
    },
    setQty: function (key, qty) {
      var items = cart.items().map(function (i) { if (i.key === key) i.qty = Math.max(1, Math.min(20, qty)); return i; });
      cart.set(items);
    },
    remove: function (key) { cart.set(cart.items().filter(function (i) { return i.key !== key; })); },
    count: function () { return cart.items().reduce(function (n, i) { return n + i.qty; }, 0); },
    subtotal: function () { return cart.items().reduce(function (n, i) { return n + i.price * i.qty; }, 0); }
  };
  function optsText(i) { return [i.size, i.color, i.scent].filter(Boolean).join(", "); }

  function totals(items, shipId, coupon) {
    var s = DATA.settings;
    var subtotal = items.reduce(function (n, i) { return n + i.price * i.qty; }, 0);
    var discount = 0;
    if (coupon) discount = coupon.type === "percent" ? Math.round(subtotal * coupon.value) / 100 : Math.min(subtotal, coupon.value);
    var after = subtotal - discount;
    var method = s.shipping.filter(function (m) { return m.id === shipId; })[0] || s.shipping[0];
    var free = method.freeOverThreshold && after >= s.freeShippingThreshold;
    var ship = free ? 0 : method.price;
    return { subtotal: subtotal, discount: discount, after: after, ship: ship, free: free, total: after + ship, method: method };
  }
  function shipMessage(amount) {
    var t = DATA.settings.freeShippingThreshold;
    if (amount <= 0) return { html: "משלוח חינם בהזמנה מעל " + money(t), p: 0 };
    if (amount >= t) return { html: "<strong>יש לך משלוח חינם</strong> לשליח ולנקודת איסוף", p: 100 };
    return { html: "נותרו לך <strong>" + money(t - amount) + "</strong> למשלוח חינם", p: (amount / t) * 100 };
  }
  function paintMeter(el, amount) {
    if (!el) return;
    var m = shipMessage(amount);
    var p = el.querySelector("p");
    if (p) p.innerHTML = m.html;
    var bar = el.querySelector(".meter");
    if (bar) bar.style.setProperty("--p", m.p + "%");
  }

  /* ---------- rendering ---------- */
  function artHTML(p) { return '<div class="art art--' + esc(p.art || "candle") + '"></div>'; }
  function mediaHTML(p, opts) {
    opts = opts || {};
    var imgs = p.images || [];
    var i = opts.index || 0;
    var cls = "media" + (p.art === "candle-dark" || p.art === "holder" ? " media--stone" : "") + (opts.cls ? " " + opts.cls : "");
    if (imgs[i]) {
      var alt = opts.decorative ? "" : esc(p.name + ", " + (p.short || ""));
      var second = opts.hover && imgs[1] ? '<img class="img-alt" src="' + esc(imgs[1]) + '" alt="" loading="lazy">' : "";
      return '<div class="' + cls + '"><img src="' + esc(imgs[i]) + '" alt="' + alt + '"' + (opts.lazy ? ' loading="lazy"' : "") + ">" + second + "</div>";
    }
    var label = opts.decorative ? ' aria-hidden="true"' : ' role="img" aria-label="' + esc(p.name + ", " + (p.short || "")) + '"';
    return '<div class="' + cls + '"' + label + ">" + artHTML(p) + "</div>";
  }
  function priceHTML(p, size) {
    var now = priceOf(p, size);
    var from = p.sizes && p.sizes.length > 1 && size == null ? "החל מ-" : "";
    if (p.compareAt && p.compareAt > now) {
      return '<span class="price-now price-now--sale">' + from + money(now) + '</span><span class="price-was"><span class="visually-hidden">במקום </span>' + money(p.compareAt) + "</span>";
    }
    return '<span class="price-now">' + from + money(now) + "</span>";
  }
  function cardHTML(p) {
    var badges = [];
    if (!inStock(p)) badges.push('<span class="badge badge--out">אזל מהמלאי</span>');
    else {
      if (p.compareAt && p.compareAt > priceOf(p)) badges.push('<span class="badge badge--sale">מבצע</span>');
      if (p.isNew) badges.push('<span class="badge">חדש</span>');
      if (p.badge) badges.push('<span class="badge">' + esc(p.badge) + "</span>");
    }
    return '<li class="card">' +
      '<div class="card__mediawrap">' +
        '<a class="card__link" href="product.html#' + esc(p.id) + '" tabindex="-1" aria-hidden="true">' + mediaHTML(p, { lazy: true, hover: true, decorative: true }) + "</a>" +
        (badges.length ? '<div class="badges">' + badges.join("") + "</div>" : "") +
        '<button class="quick-add" type="button" data-quick-add="' + esc(p.id) + '"' + (inStock(p) ? "" : " disabled") + '><span class="visually-hidden">הוספת ' + esc(p.name) + " לסל</span>" + ICON_BAG + "</button>" +
      "</div>" +
      '<a class="card__link" href="product.html#' + esc(p.id) + '"><h3 class="card__name">' + esc(p.name) + "</h3></a>" +
      '<p class="card__sub">' + esc(p.short || "") + "</p>" +
      '<p class="card__price">' + priceHTML(p) + "</p>" +
    "</li>";
  }
  function lineHTML(i, compact) {
    var p = product(i.id);
    return '<li class="line" data-key="' + esc(i.key) + '">' +
      '<a href="product.html#' + esc(p.id) + '" tabindex="-1" aria-hidden="true">' + mediaHTML(p, { decorative: true }) + "</a>" +
      '<div class="line__info">' +
        '<a class="line__name" href="product.html#' + esc(p.id) + '">' + esc(i.name) + "</a>" +
        (optsText(i) ? '<p class="line__opts">' + esc(optsText(i)) + "</p>" : "") +
        '<p class="line__opts">' + money(i.price) + " ליחידה</p>" +
        (compact ? '<div class="line__row">' + qtyHTML(i) + '<button type="button" class="link-btn line__remove" data-remove>הסרה</button></div>' : '<button type="button" class="link-btn line__remove" data-remove>הסרה</button>') +
      "</div>" +
      (compact ? "" : '<div class="line__row">' + qtyHTML(i) + "</div>") +
      '<p class="line__total">' + money(i.price * i.qty) + "</p>" +
    "</li>";
  }
  function qtyHTML(i) {
    return '<div class="qty qty--sm" role="group" aria-label="כמות של ' + esc(i.name) + '">' +
      '<button type="button" data-step="1" aria-label="הוספת יחידה">+</button>' +
      '<output aria-live="polite">' + i.qty + "</output>" +
      '<button type="button" data-step="-1" aria-label="הורדת יחידה"' + (i.qty <= 1 ? " disabled" : "") + ">−</button>" +
    "</div>";
  }
  function bindLines(root) {
    root.addEventListener("click", function (e) {
      var line = e.target.closest(".line");
      if (!line) return;
      var key = line.getAttribute("data-key");
      var step = e.target.closest("[data-step]");
      if (step) {
        var i = cart.items().filter(function (x) { return x.key === key; })[0];
        if (i) cart.setQty(key, i.qty + Number(step.getAttribute("data-step")));
      } else if (e.target.closest("[data-remove]")) {
        cart.remove(key);
        toast("הפריט הוסר מהסל");
      }
    });
  }

  /* ---------- toast ---------- */
  function toast(html) {
    var t = $("#toast");
    if (!t) return;
    t.innerHTML = html;
    t.classList.add("is-shown");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("is-shown"); }, 3800);
  }

  /* ---------- overlays: one open at a time, with scrim, Esc and focus return ---------- */
  var overlay = { el: null, opener: null };
  function openOverlay(el, opener) {
    if (overlay.el) closeOverlay(true);
    overlay.el = el;
    overlay.opener = opener || document.activeElement;
    el.hidden = false;
    var scrim = $("#scrim");
    scrim.hidden = false;
    if (opener) opener.setAttribute("aria-expanded", "true");
    document.body.classList.add("is-locked");
    requestAnimationFrame(function () {
      el.classList.add("is-open");
      scrim.classList.add("is-open");
      var focusable = el.querySelector("input, button, a[href]");
      if (focusable) focusable.focus({ preventScroll: true });
    });
  }
  function closeOverlay(instant) {
    var el = overlay.el;
    if (!el) return;
    var scrim = $("#scrim");
    el.classList.remove("is-open");
    scrim.classList.remove("is-open");
    document.body.classList.remove("is-locked");
    if (overlay.opener && overlay.opener.setAttribute) overlay.opener.setAttribute("aria-expanded", "false");
    var opener = overlay.opener;
    overlay.el = null;
    var done = function () { if (!el.classList.contains("is-open")) el.hidden = true; if (!overlay.el) scrim.hidden = true; };
    if (instant || reduceMotion) done(); else setTimeout(done, 400);
    if (opener && opener.focus && !instant) opener.focus({ preventScroll: true });
  }
  function trapFocus(e) {
    if (!overlay.el || e.key !== "Tab") return;
    var f = $$("a[href], button:not([disabled]), input, select, textarea", overlay.el).filter(function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- shared UI ---------- */
  function initChrome() {
    // header shadow on scroll
    var header = $("#site-header");
    var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 10); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // announcement pause (WCAG 2.2.2)
    var ann = $("#announce-toggle");
    if (ann) ann.addEventListener("click", function () {
      var paused = document.documentElement.classList.toggle("marquee-paused");
      ann.setAttribute("aria-pressed", String(paused));
      ann.querySelector(".visually-hidden").textContent = paused ? "הפעלת ההודעות הנעות" : "עצירת ההודעות הנעות";
    });

    // desktop submenu via keyboard/click on the arrow
    $$(".submenu-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var li = b.closest(".has-menu");
        var open = li.classList.toggle("is-open");
        b.setAttribute("aria-expanded", String(open));
      });
    });
    document.addEventListener("click", function (e) {
      $$(".has-menu.is-open").forEach(function (li) {
        if (!li.contains(e.target)) { li.classList.remove("is-open"); li.querySelector(".submenu-btn").setAttribute("aria-expanded", "false"); }
      });
    });

    // overlays
    $("#menu-open").addEventListener("click", function (e) { openOverlay($("#mobile-menu"), e.currentTarget); });
    $("#cart-open").addEventListener("click", function (e) { openOverlay($("#cart-drawer"), e.currentTarget); });
    $("#search-open").addEventListener("click", function (e) { openOverlay($("#search-panel"), e.currentTarget); });
    $("#scrim").addEventListener("click", function () { closeOverlay(); });
    $$("[data-close]").forEach(function (b) { b.addEventListener("click", function () { closeOverlay(); }); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (overlay.el) closeOverlay();
        $$(".has-menu.is-open").forEach(function (li) { li.classList.remove("is-open"); });
      }
      trapFocus(e);
    });

    // quick add (cards anywhere)
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-quick-add]");
      if (!b) return;
      var p = product(b.getAttribute("data-quick-add"));
      if (!p || !inStock(p)) return;
      cart.add(p, { size: p.sizes && p.sizes[0] ? p.sizes[0].label : "", color: (p.colors || [])[0] || "", scent: (p.scents || [])[0] || "" }, 1);
      openOverlay($("#cart-drawer"), $("#cart-open"));
    });

    // contact links + socials
    var s = DATA.settings;
    $$("[data-whatsapp-link]").forEach(function (a) {
      a.href = "https://wa.me/" + s.whatsapp;
      if (a.hasAttribute("data-whatsapp-text")) a.textContent = (a.closest(".contact__info") ? "" : "וואטסאפ ") + (s.whatsappDisplay || "");
    });
    $$("[data-email-link]").forEach(function (a) {
      if (s.email) { a.href = "mailto:" + s.email; a.textContent = s.email; } else a.closest("li, div").hidden = true;
    });
    $$("[data-instagram-link]").forEach(function (a) {
      if (s.instagram) { a.href = "https://instagram.com/" + s.instagram.replace(/^@/, ""); a.closest("li").hidden = false; a.hidden = false; }
      else a.closest("li").hidden = true;
    });

    // newsletter (connected to a mailing service in a later stage)
    var nf = $("#newsletter-form");
    if (nf) nf.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("#newsletter-email"), status = $("#newsletter-status");
      if (!input.value || !input.checkValidity()) { status.textContent = "צריך כתובת מייל מלאה, למשל name@gmail.com."; input.focus(); return; }
      status.textContent = "נרשמת. נתראה בתיבת המייל. (בשלב הזה ההרשמה עוד לא נשמרת)";
      nf.reset();
    });
    var y = $("#year");
    if (y) y.textContent = new Date().getFullYear();

    initSearch();
    bindLines($("#drawer-body"));
    document.addEventListener("cart:change", renderCartChrome);
    renderCartChrome();
  }

  function renderCartChrome() {
    var items = cart.items();
    var n = items.reduce(function (s, i) { return s + i.qty; }, 0);
    var sub = items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
    $$(".cart-count").forEach(function (el) {
      if (el.textContent !== String(n) && !reduceMotion) { el.classList.add("is-bumped"); setTimeout(function () { el.classList.remove("is-bumped"); }, 300); }
      el.textContent = n; el.setAttribute("data-n", n);
    });
    $$(".cart-label").forEach(function (el) { el.textContent = "סל הקניות, " + n + " פריטים"; });
    var strip = $("#ship-strip");
    if (strip) strip.innerHTML = shipMessage(sub).html;

    var body = $("#drawer-body"), foot = $("#drawer-foot");
    $("#drawer-count").textContent = n ? "(" + n + ")" : "";
    paintMeter($("#drawer-ship"), sub);
    if (!items.length) {
      body.innerHTML = '<div class="drawer__empty"><p>הסל ריק כרגע.</p><a class="btn btn--outline" href="shop.html">לחנות</a></div>';
      foot.hidden = true;
    } else {
      body.innerHTML = '<ul class="lines">' + items.map(function (i) { return lineHTML(i, true); }).join("") + "</ul>";
      foot.hidden = false;
      $("#drawer-subtotal").textContent = money(sub);
    }
  }

  function initSearch() {
    var input = $("#search-input"), results = $("#search-results"), form = $("#search-form");
    function match(q) {
      q = q.trim().toLowerCase();
      if (!q) return [];
      return DATA.products.filter(function (p) {
        var cat = category(p.category);
        var hay = [p.name, p.short, cat && cat.label].concat(p.colors || [], p.scents || []).join(" ").toLowerCase();
        return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
      });
    }
    ORE.search = match;
    input.addEventListener("input", function () {
      var q = input.value.trim();
      if (!q) { results.innerHTML = ""; return; }
      var hits = match(q);
      results.innerHTML = hits.length ?
        '<ul class="search-hits">' + hits.slice(0, 8).map(function (p) {
          return '<li><a class="search-hit" href="product.html#' + esc(p.id) + '">' + mediaHTML(p, { decorative: true }) + "<div><strong>" + esc(p.name) + "</strong><span>" + money(priceOf(p)) + "</span></div></a></li>";
        }).join("") + "</ul>" + (hits.length > 0 ? '<a class="link-btn search-all" href="shop.html#search" data-search-all>לכל ' + hits.length + " התוצאות</a>" : "") :
        '<p class="search-empty">לא מצאנו מוצרים בשם "' + esc(q) + '". נסי מילה אחרת, למשל נר, מגש או מתנה.</p>';
    });
    function go() { save(KEYS.search, input.value.trim()); save(KEYS.intent, { page: "shop", value: "search", t: Date.now() }); }
    results.addEventListener("click", function (e) { if (e.target.closest("[data-search-all]")) go(); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!input.value.trim()) return;
      go();
      if (document.body.getAttribute("data-page") === "shop") { closeOverlay(true); location.hash = "search"; window.dispatchEvent(new HashChangeEvent("hashchange")); }
      else location.href = "shop.html#search";
    });
  }

  /* rails: arrow buttons scroll a product row (RTL aware) */
  function initRails() {
    $$("[data-rail]").forEach(function (rail) {
      var list = rail.querySelector(".products--rail");
      var prev = rail.querySelector('[data-rail-dir="-1"]'), next = rail.querySelector('[data-rail-dir="1"]');
      function update() {
        var x = Math.abs(list.scrollLeft);
        prev.disabled = x <= 2;
        next.disabled = x + list.clientWidth >= list.scrollWidth - 2;
      }
      [prev, next].forEach(function (b) {
        b.addEventListener("click", function () {
          var dir = Number(b.getAttribute("data-rail-dir"));
          list.scrollBy({ left: -dir * list.clientWidth * 0.9, behavior: reduceMotion ? "auto" : "smooth" });
        });
      });
      list.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update);
      setTimeout(update, 50);
    });
  }

  /* ---------- pages ---------- */
  var ORE = (window.ORE = {});

  function pageHome() {
    var cats = $("#home-categories");
    cats.innerHTML = DATA.settings.categories.map(function (c) {
      return '<li><a class="cat-card" href="shop.html#' + esc(c.id) + '">' +
        mediaHTML({ name: c.label, art: c.art, images: c.image ? [c.image] : [] }, { decorative: true }) +
        '<div class="cat-card__body"><h3>' + esc(c.label) + "</h3><p>" + esc(c.description || "") + '</p><span class="btn btn--outline">לגלות</span></div></a></li>';
    }).join("");
    $("#best-row").innerHTML = DATA.products.filter(function (p) { return p.bestSeller; }).map(cardHTML).join("");
    $("#new-grid").innerHTML = DATA.products.filter(function (p) { return p.isNew; }).slice(0, 4).map(cardHTML).join("");
    initHero();
  }

  function initHero() {
    var hero = $(".hero");
    if (!hero) return;
    var slides = $$(".hero__slide", hero), dots = $$(".hero__dots button", hero);
    var i = 0, timer = null, paused = reduceMotion, hold = false;
    function show(n) {
      i = (n + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle("is-active", k === i); s.setAttribute("aria-hidden", String(k !== i)); $$("a", s).forEach(function (a) { a.tabIndex = k === i ? 0 : -1; }); });
      dots.forEach(function (d, k) { if (k === i) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
    }
    function tick() { clearInterval(timer); if (!paused && !hold) timer = setInterval(function () { show(i + 1); }, 6000); }
    $$(".hero__arrow", hero).forEach(function (b) { b.addEventListener("click", function () { show(i + Number(b.getAttribute("data-dir"))); tick(); }); });
    dots.forEach(function (d, k) { d.addEventListener("click", function () { show(k); tick(); }); });
    var pause = $(".hero__pause", hero);
    pause.addEventListener("click", function () {
      paused = !paused;
      hero.classList.toggle("is-paused", paused);
      pause.setAttribute("aria-pressed", String(paused));
      pause.querySelector(".visually-hidden").textContent = paused ? "הפעלת ההחלפה האוטומטית" : "עצירת ההחלפה האוטומטית";
      tick();
    });
    if (reduceMotion) { hero.classList.add("is-paused"); pause.setAttribute("aria-pressed", "true"); }
    hero.addEventListener("mouseenter", function () { hold = true; tick(); });
    hero.addEventListener("mouseleave", function () { hold = false; tick(); });
    hero.addEventListener("focusin", function () { hold = true; tick(); });
    hero.addEventListener("focusout", function () { hold = false; tick(); });
    var x0 = null;
    hero.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener("touchend", function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) { show(i + (dx > 0 ? 1 : -1)); tick(); } // RTL: swipe right = next
      x0 = null;
    });
    show(0);
    tick();
  }

  function pageShop() {
    var s = DATA.settings;
    var priceBands = [
      { id: "lt100", label: "עד ₪100", test: function (v) { return v < 100; } },
      { id: "100-150", label: "₪100–₪150", test: function (v) { return v >= 100 && v <= 150; } },
      { id: "gt150", label: "מעל ₪150", test: function (v) { return v > 150; } }
    ];
    var state = { cat: "all", tag: "", q: "", colors: [], scents: [], price: "all", sort: "featured" };

    function readRoute() {
      var r = routeValue("shop");
      state.cat = "all"; state.tag = ""; state.q = "";
      if (category(r)) state.cat = r;
      else if (r === "best" || r === "new") state.tag = r;
      else if (r === "search") state.q = load(KEYS.search, "") || "";
    }
    function uniq(key) {
      var out = [];
      DATA.products.forEach(function (p) { (p[key] || []).forEach(function (v) { if (out.indexOf(v) < 0) out.push(v); }); });
      return out;
    }
    function base() {
      return DATA.products.filter(function (p) {
        if (state.tag === "best" && !p.bestSeller) return false;
        if (state.tag === "new" && !p.isNew) return false;
        if (state.q && ORE.search(state.q).indexOf(p) < 0) return false;
        return true;
      });
    }
    function filtered(skip) {
      return base().filter(function (p) {
        if (skip !== "cat" && state.cat !== "all" && p.category !== state.cat) return false;
        if (skip !== "colors" && state.colors.length && !state.colors.some(function (c) { return (p.colors || []).indexOf(c) >= 0; })) return false;
        if (skip !== "scents" && state.scents.length && !state.scents.some(function (c) { return (p.scents || []).indexOf(c) >= 0; })) return false;
        if (skip !== "price" && state.price !== "all") {
          var band = priceBands.filter(function (b) { return b.id === state.price; })[0];
          if (band && !band.test(priceOf(p))) return false;
        }
        return true;
      });
    }
    function group(id, title, type, options, open) {
      return '<details class="filter"' + (open ? " open" : "") + "><summary>" + esc(title) + '</summary><div class="filter__opts" role="group" aria-label="' + esc(title) + '">' +
        options.map(function (o) {
          return '<label class="check"><input type="' + type + '" name="f-' + id + '" value="' + esc(o.value) + '"' + (o.checked ? " checked" : "") + "><span>" + esc(o.label) + '</span><span class="count">' + o.count + "</span></label>";
        }).join("") + "</div></details>";
    }
    function renderFilters() {
      var counts = function (skip, pred) { return filtered(skip).filter(pred).length; };
      var html = "";
      html += group("cat", "קטגוריה", "radio", [{ value: "all", label: "הכול", checked: state.cat === "all", count: counts("cat", function () { return true; }) }].concat(s.categories.map(function (c) {
        return { value: c.id, label: c.label, checked: state.cat === c.id, count: counts("cat", function (p) { return p.category === c.id; }) };
      })), true);
      html += group("colors", "צבע", "checkbox", uniq("colors").map(function (v) {
        return { value: v, label: v, checked: state.colors.indexOf(v) >= 0, count: counts("colors", function (p) { return (p.colors || []).indexOf(v) >= 0; }) };
      }), state.colors.length > 0 || window.innerWidth >= 1024);
      html += group("scents", "ריח", "checkbox", uniq("scents").map(function (v) {
        return { value: v, label: v, checked: state.scents.indexOf(v) >= 0, count: counts("scents", function (p) { return (p.scents || []).indexOf(v) >= 0; }) };
      }), state.scents.length > 0);
      html += group("price", "מחיר", "radio", [{ value: "all", label: "כל המחירים", checked: state.price === "all", count: counts("price", function () { return true; }) }].concat(priceBands.map(function (b) {
        return { value: b.id, label: b.label, checked: state.price === b.id, count: counts("price", function (p) { return b.test(priceOf(p)); }) };
      })), state.price !== "all");
      var holder = $("#filter-groups");
      var openState = $$("details", holder).map(function (d) { return d.open; });
      holder.innerHTML = html;
      if (openState.length) $$("details", holder).forEach(function (d, k) { d.open = openState[k]; });
    }
    function renderHead() {
      var title = "כל המוצרים", desc = "נרות וכלי בטון בעבודת יד. כל מוצר מגיע ארוז, מוכן למתנה.";
      if (state.q) { title = "תוצאות חיפוש: " + state.q; desc = ""; }
      else if (state.tag === "best") { title = "הנמכרים ביותר"; desc = "מה שהכי אוהבים אצלנו."; }
      else if (state.tag === "new") { title = "חדש בסטודיו"; desc = "המוצרים האחרונים שיצאו מהתבניות."; }
      else if (state.cat !== "all") { var c = category(state.cat); title = c.label; desc = c.description || ""; }
      $("#shop-title").textContent = title;
      $("#shop-desc").textContent = desc;
      $("#shop-desc").hidden = !desc;
      $("#crumb-current").textContent = title;
      document.title = title + " | ORÉ";
    }
    function renderChips() {
      var chips = [];
      if (state.q) chips.push(["q", "", "חיפוש: " + state.q]);
      if (state.tag) chips.push(["tag", "", state.tag === "best" ? "הנמכרים ביותר" : "חדש בסטודיו"]);
      if (state.cat !== "all") chips.push(["cat", "", category(state.cat).label]);
      state.colors.forEach(function (v) { chips.push(["colors", v, v]); });
      state.scents.forEach(function (v) { chips.push(["scents", v, v]); });
      if (state.price !== "all") chips.push(["price", "", priceBands.filter(function (b) { return b.id === state.price; })[0].label]);
      $("#active-filters").innerHTML = chips.map(function (c) {
        return '<button type="button" class="chip-x" data-k="' + c[0] + '" data-v="' + esc(c[1]) + '"><span class="visually-hidden">הסרת הסינון </span>' + esc(c[2]) + "</button>";
      }).join("");
    }
    function render() {
      var list = filtered().slice();
      if (state.sort === "price-asc") list.sort(function (a, b) { return priceOf(a) - priceOf(b); });
      if (state.sort === "price-desc") list.sort(function (a, b) { return priceOf(b) - priceOf(a); });
      if (state.sort === "new") list.sort(function (a, b) { return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0); });
      $("#shop-count").textContent = list.length === 1 ? "מוצר אחד" : list.length + " מוצרים";
      $("#shop-grid").innerHTML = list.length ? list.map(cardHTML).join("") :
        '<li class="empty" style="grid-column:1/-1"><p>אין מוצרים שמתאימים לבחירה הזו. אפשר להסיר חלק מהסינון או לחפש משהו אחר.</p><button type="button" class="btn btn--outline" id="empty-clear">ניקוי הסינון</button></li>';
      renderHead(); renderFilters(); renderChips();
    }
    function clearAll() { state.cat = "all"; state.tag = ""; state.q = ""; state.colors = []; state.scents = []; state.price = "all"; try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ } render(); }

    $("#filter-groups").addEventListener("change", function (e) {
      var t = e.target, id = t.name.replace("f-", "");
      if (id === "cat") state.cat = t.value;
      else if (id === "price") state.price = t.value;
      else {
        var arr = state[id];
        if (t.checked) arr.push(t.value); else arr.splice(arr.indexOf(t.value), 1);
      }
      render();
    });
    $("#active-filters").addEventListener("click", function (e) {
      var b = e.target.closest(".chip-x");
      if (!b) return;
      var k = b.getAttribute("data-k"), v = b.getAttribute("data-v");
      if (k === "colors" || k === "scents") state[k].splice(state[k].indexOf(v), 1);
      else if (k === "cat") state.cat = "all";
      else if (k === "price") state.price = "all";
      else if (k === "tag") state.tag = "";
      else if (k === "q") state.q = "";
      render();
    });
    $("#shop-grid").addEventListener("click", function (e) { if (e.target.id === "empty-clear") clearAll(); });
    $("#filters-clear").addEventListener("click", clearAll);
    $("#shop-sort").addEventListener("change", function (e) { state.sort = e.target.value; render(); });
    $("#filters-open").addEventListener("click", function (e) { openOverlay($("#filters"), e.currentTarget); });
    $$("[data-close-filters]").forEach(function (b) { b.addEventListener("click", function () { closeOverlay(); }); });
    window.addEventListener("hashchange", function () { readRoute(); render(); });
    readRoute();
    render();
  }

  function pageProduct() {
    var root = $("#product");
    var s = DATA.settings;
    function render() {
      var id = routeValue("product");
      var p = product(id) || DATA.products[0];
      document.title = p.name + " | ORÉ";
      var cat = category(p.category);
      var imgs = p.images && p.images.length ? p.images : [null];
      var state = { size: p.sizes && p.sizes[0] ? p.sizes[0].label : "", color: (p.colors || [])[0] || "", scent: (p.scents || [])[0] || "", img: 0 };
      var available = inStock(p);

      function optSet(name, label, values) {
        if (!values || !values.length) return "";
        return '<fieldset class="opt"><legend>' + esc(label) + ': <b data-sel="' + name + '">' + esc(state[name]) + '</b></legend><div class="opt__list">' +
          values.map(function (v, k) {
            var val = typeof v === "string" ? v : v.label;
            var id = "o-" + name + "-" + k;
            return '<input class="opt__input" type="radio" name="' + name + '" id="' + id + '" value="' + esc(val) + '"' + (k === 0 ? " checked" : "") + '><label class="opt__btn" for="' + id + '">' + esc(val) + "</label>";
          }).join("") + "</div></fieldset>";
      }
      function shipList() {
        return s.shipping.map(function (m) {
          return "<li>" + esc(m.label) + ": " + (m.price ? money(m.price) : "ללא עלות") + (m.freeOverThreshold ? ", חינם בהזמנה מעל " + money(s.freeShippingThreshold) : "") + "</li>";
        }).join("");
      }
      var perkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

      root.innerHTML =
        '<nav class="crumbs" aria-label="מיקום באתר"><a href="index.html">דף הבית</a><span aria-hidden="true">/</span>' +
          (cat ? '<a href="shop.html#' + esc(cat.id) + '">' + esc(cat.label) + '</a><span aria-hidden="true">/</span>' : "") +
          '<span aria-current="page">' + esc(p.name) + "</span></nav>" +
        '<div class="pdp">' +
          '<div class="gallery">' +
            (imgs.length > 1 ? '<div class="gallery__thumbs" role="group" aria-label="תמונות המוצר">' + imgs.map(function (src, k) {
              return '<button type="button" class="thumb" data-img="' + k + '" aria-pressed="' + (k === 0) + '"><span class="visually-hidden">תמונה ' + (k + 1) + "</span>" + mediaHTML(p, { index: k, decorative: true }) + "</button>";
            }).join("") + "</div>" : "") +
            '<div class="gallery__main" id="gallery-main">' + mediaHTML(p, { index: 0 }) + "</div>" +
          "</div>" +
          '<div class="pdp__info">' +
            '<h1 class="pdp__title">' + esc(p.name) + "</h1>" +
            '<p class="pdp__short">' + esc(p.short || "") + "</p>" +
            '<p class="pdp__price" id="pdp-price">' + priceHTML(p, state.size) + "</p>" +
            (p.demo ? '<p class="pdp__demo">זה מוצר לדוגמה, כדי להראות איך העמוד נראה. הוא יוחלף במוצר אמיתי.</p>' : "") +
            '<form id="pdp-form" class="pdp__form" novalidate>' +
              optSet("size", "גודל", p.sizes) + optSet("color", "צבע", p.colors) + optSet("scent", "ריח", p.scents) +
              '<div class="buy">' +
                '<div class="qty" role="group" aria-label="כמות"><button type="button" data-q="1" aria-label="הוספת יחידה">+</button><input id="pdp-qty" type="number" value="1" min="1" max="20" inputmode="numeric" aria-label="כמות"><button type="button" data-q="-1" aria-label="הורדת יחידה">−</button></div>' +
                '<button class="btn" type="submit" id="pdp-add"' + (available ? "" : " disabled") + ">" + (available ? "הוספה לסל" : "אזל מהמלאי") + "</button>" +
              "</div>" +
            "</form>" +
            '<ul class="perks">' +
              "<li>" + perkIcon + "משלוח חינם בהזמנה מעל " + money(s.freeShippingThreshold) + "</li>" +
              "<li>" + perkIcon + "מגיע בקופסה אטומה, מוכן למתנה</li>" +
              "<li>" + perkIcon + "יצוק ומלוטש ביד ביבנה</li>" +
            "</ul>" +
            '<div class="accs">' +
              '<details class="acc" open><summary>תיאור המוצר</summary><div class="acc__body"><p>' + esc(p.description || "") + "</p></div></details>" +
              (p.category === "candles" || p.category === "gifts" ? '<details class="acc"><summary>שימוש ובטיחות</summary><div class="acc__body"><ul>' + (s.safety || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div></details>" : "") +
              '<details class="acc"><summary>משלוחים והחזרות</summary><div class="acc__body"><ul>' + shipList() + '</ul><p>תנאי ההחזרה המלאים מופיעים ב<a href="policies.html">עמוד המדיניות</a>.</p></div></details>' +
              '<details class="acc"><summary>תשלום</summary><div class="acc__body"><p>' + esc((s.payments || []).filter(function (x) { return x.enabled; }).map(function (x) { return x.label + ": " + x.note; }).join(" ")) + " פרטי אשראי לא נשמרים באתר.</p></div></details>" +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="sticky-buy" id="sticky-buy" aria-hidden="true"><div class="sticky-buy__info"><strong>' + esc(p.name) + '</strong><span id="sticky-price">' + money(priceOf(p, state.size)) + '</span></div><button class="btn btn--sm" type="button" tabindex="-1" id="sticky-add"' + (available ? "" : " disabled") + ">הוספה לסל</button></div>";

      var form = $("#pdp-form");
      form.addEventListener("change", function (e) {
        if (!e.target.name || !(e.target.name in state)) return;
        state[e.target.name] = e.target.value;
        var sel = form.querySelector('[data-sel="' + e.target.name + '"]');
        if (sel) sel.textContent = e.target.value;
        if (e.target.name === "size") { $("#pdp-price").innerHTML = priceHTML(p, state.size); $("#sticky-price").textContent = money(priceOf(p, state.size)); }
      });
      var qty = $("#pdp-qty");
      $$("[data-q]", form).forEach(function (b) {
        b.addEventListener("click", function () { qty.value = Math.max(1, Math.min(20, (parseInt(qty.value, 10) || 1) + Number(b.getAttribute("data-q")))); });
      });
      function add() {
        if (!available) return;
        cart.add(p, state, Math.max(1, Math.min(20, parseInt(qty.value, 10) || 1)));
        openOverlay($("#cart-drawer"), $("#cart-open"));
      }
      form.addEventListener("submit", function (e) { e.preventDefault(); add(); });
      $("#sticky-add").addEventListener("click", add);

      // gallery
      var main = $("#gallery-main");
      $$(".thumb", root).forEach(function (t) {
        t.addEventListener("click", function () {
          var k = Number(t.getAttribute("data-img"));
          main.innerHTML = mediaHTML(p, { index: k });
          main.classList.remove("is-zoomed");
          $$(".thumb", root).forEach(function (o) { o.setAttribute("aria-pressed", String(o === t)); });
        });
      });
      main.addEventListener("click", function (e) {
        var img = main.querySelector("img");
        if (!img) return;
        var r = main.getBoundingClientRect();
        img.style.transformOrigin = ((e.clientX - r.left) / r.width) * 100 + "% " + ((e.clientY - r.top) / r.height) * 100 + "%";
        main.classList.toggle("is-zoomed");
      });

      // mobile sticky add-to-cart once the main button scrolls away
      var sticky = $("#sticky-buy");
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (en) { sticky.classList.toggle("is-shown", !en[0].isIntersecting && en[0].boundingClientRect.top < 0); }, { rootMargin: "-110px 0px 0px 0px" }).observe($("#pdp-add"));
      }

      $("#related").innerHTML = DATA.products.filter(function (x) { return x.id !== p.id; })
        .sort(function (a, b) { return (b.category === p.category) - (a.category === p.category); })
        .slice(0, 8).map(cardHTML).join("");
    }
    render();
    window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); });
  }

  function pageCart() {
    function render() {
      var items = cart.items();
      $("#cart-empty").hidden = items.length > 0;
      $("#cart-full").hidden = items.length === 0;
      if (!items.length) return;
      $("#cart-lines").innerHTML = items.map(function (i) { return lineHTML(i, false); }).join("");
      var sub = cart.subtotal();
      $("#cart-subtotal").textContent = money(sub);
      paintMeter($("#cart-ship"), sub);
    }
    bindLines($("#cart-lines"));
    $("#cart-clear").addEventListener("click", function () { cart.set([]); toast("הסל רוקן"); });
    document.addEventListener("cart:change", render);
    render();
  }

  function orderMessage(o) {
    var L = [];
    L.push("שלום! אני רוצה להזמין מ-ORÉ:");
    L.push("מספר הזמנה: " + o.no);
    L.push("");
    o.items.forEach(function (i) { L.push("• " + i.name + (optsText(i) ? " (" + optsText(i) + ")" : "") + " × " + i.qty + " = " + money(i.price * i.qty)); });
    L.push("");
    L.push("סכום ביניים: " + money(o.t.subtotal));
    if (o.t.discount) L.push("הנחה (" + o.coupon + "): −" + money(o.t.discount));
    L.push("משלוח – " + o.t.method.label + ": " + (o.t.ship ? money(o.t.ship) : "חינם"));
    L.push("סה\"כ לתשלום: " + money(o.t.total));
    L.push("תשלום: " + o.payment);
    L.push("");
    L.push("שם: " + o.c.name);
    L.push("טלפון: " + o.c.phone);
    if (o.c.email) L.push("מייל: " + o.c.email);
    if (o.t.method.needsAddress) L.push("כתובת: " + o.c.street + (o.c.apt ? " (" + o.c.apt + ")" : "") + ", " + o.c.city);
    if (o.gift) { L.push(""); L.push("ברכה למתנה: " + o.gift); }
    if (o.notes) { L.push(""); L.push("הערות: " + o.notes); }
    return L.join("\n");
  }
  /* Send the order to the owner's Google Sheet + email (see docs/orders-setup.md).
     Fire-and-forget: the order is already saved here and can still go by WhatsApp. */
  function sendOrder(o) {
    var url = DATA.settings.ordersWebhook;
    if (!url) return false;
    var payload = {
      no: o.no,
      date: o.date,
      items: o.items.map(function (i) { return { name: i.name, options: optsText(i), qty: i.qty, price: i.price, total: i.price * i.qty }; }),
      subtotal: o.t.subtotal,
      discount: o.t.discount,
      coupon: o.coupon,
      shipping: o.t.method.label,
      shippingCost: o.t.ship,
      total: o.t.total,
      payment: o.payment,
      customer: o.c,
      needsAddress: !!o.t.method.needsAddress,
      gift: o.gift,
      notes: o.notes
    };
    try {
      fetch(url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), keepalive: true });
      return true;
    } catch (e) { return false; }
  }
  function waLink(text) { return "https://wa.me/" + DATA.settings.whatsapp + "?text=" + encodeURIComponent(text); }

  function pageCheckout() {
    var s = DATA.settings;
    var form = $("#checkout-form");
    var coupon = null;
    if (!cart.items().length) { $("#checkout-empty").hidden = false; return; }
    $("#checkout").hidden = false;

    $("#shipping-options").innerHTML = s.shipping.map(function (m, k) {
      return '<div class="choice"><input type="radio" name="shipping" id="ship-' + esc(m.id) + '" value="' + esc(m.id) + '"' + (k === 0 ? " checked" : "") + '><label for="ship-' + esc(m.id) + '"><span class="choice__title">' + esc(m.label) + '</span><span class="choice__price" data-ship="' + esc(m.id) + '"></span>' + (m.note ? '<span class="choice__note">' + esc(m.note) + "</span>" : "") + "</label></div>";
    }).join("");
    $("#payment-options").innerHTML = (s.payments || []).map(function (m, k) {
      return '<div class="choice"><input type="radio" name="payment" id="pay-' + esc(m.id) + '" value="' + esc(m.id) + '"' + (k === 0 && m.enabled ? " checked" : "") + (m.enabled ? "" : " disabled") + '><label for="pay-' + esc(m.id) + '"><span class="choice__title">' + esc(m.label) + '</span><span class="choice__price"></span><span class="choice__note">' + esc(m.note) + "</span></label></div>";
    }).join("");

    // prefill from saved details
    var d = load(KEYS.details, null);
    if (d) ["name", "phone", "email", "street", "city", "apt"].forEach(function (k) { var el = $("#c-" + k); if (el && d[k]) el.value = d[k]; });

    function shipId() { return (form.querySelector('input[name="shipping"]:checked') || {}).value; }
    function render() {
      var items = cart.items();
      if (!items.length) { $("#checkout").hidden = true; $("#checkout-empty").hidden = false; return; }
      var t = totals(items, shipId(), coupon);
      $("#co-lines").innerHTML = items.map(function (i) {
        var p = product(i.id);
        return '<li class="mini-line"><div style="position:relative">' + mediaHTML(p, { decorative: true }) + '<span class="mini-line__qty">' + i.qty + "</span></div><div>" + esc(i.name) + (optsText(i) ? "<small>" + esc(optsText(i)) + "</small>" : "") + "</div><span>" + money(i.price * i.qty) + "</span></li>";
      }).join("");
      s.shipping.forEach(function (m) {
        var el = form.querySelector('[data-ship="' + m.id + '"]');
        if (el) el.textContent = m.freeOverThreshold && t.after >= s.freeShippingThreshold ? "חינם" : (m.price ? money(m.price) : "ללא עלות");
      });
      $("#co-subtotal").textContent = money(t.subtotal);
      $("#co-discount-row").hidden = !t.discount;
      $("#co-discount").textContent = "−" + money(t.discount);
      $("#co-shipping").textContent = t.ship ? money(t.ship) : "חינם";
      $("#co-total").textContent = money(t.total);
      paintMeter($("#co-ship"), t.after);
      $("#address-fields").hidden = !t.method.needsAddress;
      ["c-street", "c-city"].forEach(function (id) { $("#" + id).required = !!t.method.needsAddress; });
    }
    form.addEventListener("change", function (e) { if (e.target.name === "shipping") render(); });
    document.addEventListener("cart:change", render);

    $("#coupon-apply").addEventListener("click", function () {
      var code = $("#coupon").value.trim().toUpperCase(), msg = $("#coupon-msg");
      var c = (s.coupons || []).filter(function (x) { return x.code.toUpperCase() === code; })[0];
      if (!code) { coupon = null; msg.textContent = "הקלידי קוד קופון."; }
      else if (!c) { coupon = null; msg.textContent = "הקוד " + code + " לא נמצא. בדקי את האיות ונסי שוב."; }
      else { coupon = c; msg.textContent = "הקופון הופעל: " + c.label; }
      render();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      $$(".field-error", form).forEach(function (el) { el.textContent = ""; });
      $$("[aria-invalid]", form).forEach(function (el) { el.removeAttribute("aria-invalid"); });
      var bad = $$("input[required], textarea[required], input[type=email]", form).filter(function (el) { return el.offsetParent !== null && !el.checkValidity(); });
      if (bad.length) {
        bad.forEach(function (el) {
          el.setAttribute("aria-invalid", "true");
          var err = form.querySelector('[data-error-for="' + el.id + '"]');
          if (!err) return;
          if (el.type === "checkbox") err.textContent = "צריך לאשר את התקנון כדי להמשיך.";
          else if (el.type === "tel") err.textContent = "צריך מספר טלפון תקין, למשל 050-1234567.";
          else if (el.type === "email") err.textContent = "כתובת המייל לא תקינה. אפשר גם להשאיר ריק.";
          else err.textContent = "צריך למלא את השדה הזה.";
        });
        bad[0].focus();
        return;
      }
      var items = cart.items();
      var t = totals(items, shipId(), coupon);
      var val = function (id) { return ($("#" + id) || {}).value ? $("#" + id).value.trim() : ""; };
      var now = new Date();
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      var pay = (s.payments || []).filter(function (x) { return x.id === (form.querySelector('input[name="payment"]:checked') || {}).value; })[0];
      var o = {
        no: "ORE-" + pad(now.getDate()) + pad(now.getMonth() + 1) + "-" + (100 + Math.floor(Math.random() * 900)),
        date: now.toISOString(),
        items: items,
        t: t,
        coupon: coupon ? coupon.code : "",
        payment: pay ? pay.label : "",
        c: { name: val("c-name"), phone: val("c-phone"), email: val("c-email"), street: val("c-street"), city: val("c-city"), apt: val("c-apt") },
        gift: val("c-gift"),
        notes: val("c-notes")
      };
      o.message = orderMessage(o);
      var orders = load(KEYS.orders, []);
      orders.unshift(o);
      save(KEYS.orders, orders.slice(0, 50));
      save(KEYS.details, o.c);
      cart.set([]);
      var recorded = sendOrder(o);
      $("#done-step").textContent = recorded ?
        "קיבלנו את ההזמנה, ונחזור אלייך עם בקשת תשלום בביט. רוצה לזרז? שלחי לנו אותה גם בוואטסאפ." :
        "נשאר צעד אחד: לשלוח לנו את ההזמנה בוואטסאפ. לחצי על הכפתור, ונפתחת הודעה מוכנה עם כל הפרטים.";

      $("#checkout").hidden = true;
      var done = $("#order-done");
      $("#done-no").textContent = o.no;
      $("#done-wa").href = waLink(o.message);
      $("#done-preview").textContent = o.message;
      done.hidden = false;
      window.scrollTo(0, 0);
      done.focus();
    });
    render();
  }

  function pageAccount() {
    var tabs = $$('[role="tab"]');
    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        $("#" + t.getAttribute("aria-controls")).hidden = !on;
      });
    }
    tabs.forEach(function (t, k) {
      t.addEventListener("click", function () { select(t); });
      t.addEventListener("keydown", function (e) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          var n = tabs[(k + (e.key === "ArrowLeft" ? 1 : -1) + tabs.length) % tabs.length]; // RTL
          select(n); n.focus();
        }
      });
    });
    var orders = load(KEYS.orders, []);
    $("#orders-list").innerHTML = orders.length ? orders.map(function (o) {
      var d = new Date(o.date);
      return '<li class="order"><div class="order__head"><span class="order__no" dir="ltr">' + esc(o.no) + "</span><span>" + d.toLocaleDateString("he-IL") + '</span></div><p class="order__items">' +
        o.items.map(function (i) { return esc(i.name) + " × " + i.qty; }).join(", ") + "</p>" +
        '<div class="order__foot"><span>סה"כ ' + money(o.t.total) + " · " + esc(o.t.method.label) + '</span><a class="btn btn--outline btn--sm" href="' + waLink(o.message) + '" target="_blank" rel="noopener">שליחה שוב בוואטסאפ</a></div></li>';
    }).join("") : '<li class="empty"><p>עוד אין הזמנות מהמכשיר הזה.</p><a class="btn" href="shop.html">לחנות</a></li>';

    var f = $("#details-form"), st = $("#details-status");
    var d = load(KEYS.details, {});
    ["name", "phone", "email", "street", "city", "apt"].forEach(function (k) { if (d && d[k]) $("#d-" + k).value = d[k]; });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = {};
      ["name", "phone", "email", "street", "city", "apt"].forEach(function (k) { v[k] = $("#d-" + k).value.trim(); });
      save(KEYS.details, v);
      st.textContent = "הפרטים נשמרו. הם ימולאו לבד בקופה.";
    });
    $("#details-clear").addEventListener("click", function () {
      save(KEYS.details, null);
      try { localStorage.removeItem(KEYS.details); } catch (err) { /* ignore */ }
      f.reset();
      st.textContent = "הפרטים נמחקו מהמכשיר.";
    });
  }

  function pageContact() {
    var f = $("#contact-form"), st = $("#contact-status");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var bad = $$("[required]", f).filter(function (el) { return !el.value.trim(); });
      $$(".field-error", f).forEach(function (el) { el.textContent = ""; });
      if (bad.length) {
        bad.forEach(function (el) { var err = f.querySelector('[data-error-for="' + el.id + '"]'); if (err) err.textContent = "צריך למלא את השדה הזה."; });
        bad[0].focus();
        return;
      }
      var text = "שלום ORÉ, כאן " + $("#m-name").value.trim() + ($("#m-phone").value.trim() ? " (" + $("#m-phone").value.trim() + ")" : "") + ":\n" + $("#m-msg").value.trim();
      st.innerHTML = 'ההודעה מוכנה. <a class="btn btn--wa btn--sm" href="' + waLink(text) + '" target="_blank" rel="noopener">פתיחה בוואטסאפ ושליחה</a>';
    });
  }

  /* ---------- boot ---------- */
  loadData().then(function (data) {
    DATA = data;
    initChrome();
    var page = document.body.getAttribute("data-page");
    ({ home: pageHome, shop: pageShop, product: pageProduct, cart: pageCart, checkout: pageCheckout, account: pageAccount, contact: pageContact }[page] || function () {})();
    initRails();
  }).catch(function () {
    var m = $("#main");
    if (m) m.insertAdjacentHTML("afterbegin", '<p class="empty">לא הצלחנו לטעון את החנות. רענני את העמוד, ואם זה חוזר כתבי לנו בוואטסאפ.</p>');
  });
})();
