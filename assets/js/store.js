// ORÉ — store logic: products, cart, shop filters, product page, cart + WhatsApp checkout.
// Data lives in data/products.json and data/settings.json (edited by the owner / admin).
(function () {
  "use strict";

  var CART_KEY = "ore-cart-v1";
  var ORE = (window.ORE = {});

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) {
    var v = Math.round(n * 100) / 100;
    return "₪" + (v % 1 ? v.toFixed(2) : String(v));
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var cache = {};
  function getJSON(url) {
    if (!cache[url]) {
      cache[url] = fetch(url, { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error("לא הצלחנו לטעון את " + url);
        return r.json();
      });
    }
    return cache[url];
  }
  function loadAll() {
    // preview builds embed the data directly in the page
    if (window.ORE_DATA) return Promise.resolve(window.ORE_DATA);
    return Promise.all([getJSON("data/products.json"), getJSON("data/settings.json")]).then(function (r) {
      return { products: r[0].products || [], settings: r[1] };
    });
  }

  // ---------- cart (stored in this browser) ----------
  var memoryCart = [];
  function readCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : memoryCart.slice();
    } catch (e) { return memoryCart.slice(); }
  }
  function writeCart(items) {
    memoryCart = items.slice();
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) { /* private mode */ }
    updateCartCount();
    document.dispatchEvent(new CustomEvent("cart:change"));
  }
  function cartCount() {
    return readCart().reduce(function (n, i) { return n + i.qty; }, 0);
  }
  function addToCart(item) {
    var items = readCart();
    var found = items.filter(function (i) { return i.key === item.key; })[0];
    if (found) found.qty = Math.min(20, found.qty + item.qty);
    else items.push(item);
    writeCart(items);
  }
  function updateCartCount() {
    var n = cartCount();
    $all(".cart-count").forEach(function (el) { el.textContent = n; });
    $all(".cart-label").forEach(function (el) { el.textContent = "סל הקניות, " + n + " פריטים"; });
  }
  ORE.cart = { read: readCart, write: writeCart, add: addToCart, count: cartCount };

  // ---------- product visuals ----------
  var ART = {
    "candle": { plate: "", candle: "" },
    "candle-small": { plate: "", candle: " candle--small" },
    "candle-tall-sand": { plate: " plate--sand", candle: " candle--tall candle--sand" },
    "candle-dark": { plate: "", candle: " candle--dark" },
    "slab": { plate: " plate--sand", slab: true }
  };
  function artHTML(p) {
    var a = ART[p.art] || ART.candle;
    if (a.slab) return '<div class="slab" aria-hidden="true"></div>';
    return '<div class="candle' + a.candle + '" aria-hidden="true"><div class="candle__vessel"></div><div class="candle__wax"></div><div class="candle__wick"></div><div class="candle__flame"></div></div>';
  }
  function plateClass(p) {
    var a = ART[p.art] || ART.candle;
    return "plate" + (p.images && p.images.length ? "" : a.plate);
  }
  function mediaHTML(p, index, lazy) {
    var img = p.images && p.images[index || 0];
    if (img) return '<img src="' + esc(img) + '" alt="' + esc(p.name + " – " + (p.short || "")) + '"' + (lazy ? ' loading="lazy"' : "") + ">";
    return artHTML(p);
  }
  function priceOf(p, sizeLabel) {
    if (p.sizes && p.sizes.length) {
      var s = p.sizes.filter(function (x) { return x.label === sizeLabel; })[0];
      return s ? s.price : Math.min.apply(null, p.sizes.map(function (x) { return x.price; }));
    }
    return p.price;
  }
  function priceLabel(p) {
    if (p.sizes && p.sizes.length > 1) return "החל מ-" + money(priceOf(p));
    return money(priceOf(p));
  }
  function inStock(p) { return p.stock == null || p.stock > 0; }

  function cardHTML(p) {
    var badge = !inStock(p) ? '<span class="badge">אזל מהמלאי</span>' : (p.badge ? '<span class="badge">' + esc(p.badge) + "</span>" : "");
    return '<li class="product-card">' +
      '<a href="product.html#' + esc(p.id) + '">' +
        '<div class="' + plateClass(p) + '" ' + (p.images && p.images.length ? "" : 'role="img" aria-label="' + esc(p.name + ", " + (p.short || "")) + '"') + ">" + badge + mediaHTML(p, 0, true) + "</div>" +
        '<div class="product-card__meta"><h3>' + esc(p.name) + '</h3><p class="product-card__sub">' + esc(p.short || "") + "</p></div>" +
      "</a>" +
      '<p class="product-card__price">' + priceLabel(p) + "</p>" +
    "</li>";
  }
  ORE.cardHTML = cardHTML;

  function loadError(root) {
    if (root) root.innerHTML = '<p class="empty-state">לא הצלחנו לטעון את המוצרים. רעננו את העמוד, ואם זה חוזר כתבו לנו בוואטסאפ.</p>';
  }

  // ---------- toast ----------
  function toast(html) {
    var t = $("#toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      t.setAttribute("role", "status");
      t.setAttribute("aria-live", "polite");
      document.body.appendChild(t);
    }
    t.innerHTML = html;
    t.classList.add("is-shown");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("is-shown"); }, 4500);
  }

  // ---------- WhatsApp floating button + footer contact ----------
  function initContact(settings) {
    if (!settings.whatsapp) return;
    var href = "https://wa.me/" + settings.whatsapp;
    if (!$(".wa-float")) {
      var a = document.createElement("a");
      a.className = "wa-float";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML = '<span class="visually-hidden">כתבי לנו בוואטסאפ</span><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.1-1.2l-.5-.3z"/></svg>';
      document.body.appendChild(a);
    }
    $all("[data-whatsapp-link]").forEach(function (el) {
      el.href = href;
      if (el.hasAttribute("data-whatsapp-text")) el.textContent = "וואטסאפ " + (settings.whatsappDisplay || "");
    });
  }

  // ---------- home: featured products ----------
  function initFeatured(data) {
    var root = $("#featured-products");
    if (!root) return;
    var list = data.products.filter(function (p) { return p.featured; });
    root.innerHTML = list.map(cardHTML).join("");
  }

  // ---------- shop page ----------
  function initShop(data) {
    var root = $("#shop-grid");
    if (!root) return;
    var products = data.products;
    var state = { cat: "all", color: "all", scent: "all", sort: "featured" };
    var hash = location.hash.slice(1);
    if (data.settings.categories.some(function (c) { return c.id === hash; })) state.cat = hash;

    function uniq(key) {
      var out = [];
      products.forEach(function (p) { (p[key] || []).forEach(function (v) { if (out.indexOf(v) < 0) out.push(v); }); });
      return out;
    }
    function chips(group, label, options) {
      var all = [{ id: "all", label: "הכול" }].concat(options);
      return '<div class="filter-group" role="group" aria-label="' + esc(label) + '"><span class="filter-label" aria-hidden="true">' + esc(label) + "</span><div class=\"chips\">" +
        all.map(function (o) {
          return '<button type="button" class="chip" data-group="' + group + '" data-value="' + esc(o.id) + '" aria-pressed="' + (state[group] === o.id) + '">' + esc(o.label) + "</button>";
        }).join("") + "</div></div>";
    }
    var filters = $("#shop-filters");
    filters.innerHTML =
      chips("cat", "קטגוריה", data.settings.categories) +
      chips("color", "צבע", uniq("colors").map(function (v) { return { id: v, label: v }; })) +
      chips("scent", "ריח", uniq("scents").map(function (v) { return { id: v, label: v }; }));

    filters.addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      state[b.dataset.group] = b.dataset.value;
      $all('.chip[data-group="' + b.dataset.group + '"]', filters).forEach(function (c) {
        c.setAttribute("aria-pressed", String(c === b));
      });
      if (b.dataset.group === "cat") {
        try { history.replaceState(null, "", state.cat === "all" ? location.pathname : "#" + state.cat); } catch (err) { /* ignore */ }
      }
      render();
    });
    $("#shop-sort").addEventListener("change", function (e) { state.sort = e.target.value; render(); });

    function render() {
      var list = products.filter(function (p) {
        return (state.cat === "all" || p.category === state.cat) &&
          (state.color === "all" || (p.colors || []).indexOf(state.color) >= 0) &&
          (state.scent === "all" || (p.scents || []).indexOf(state.scent) >= 0);
      });
      if (state.sort === "price-asc") list.sort(function (a, b) { return priceOf(a) - priceOf(b); });
      if (state.sort === "price-desc") list.sort(function (a, b) { return priceOf(b) - priceOf(a); });
      $("#shop-count").textContent = list.length === 1 ? "מוצר אחד" : list.length + " מוצרים";
      root.innerHTML = list.length ? list.map(cardHTML).join("") :
        '<li class="empty-state">אין כרגע מוצרים שמתאימים לבחירה הזו. מוצרים חדשים בדרך, ובינתיים אפשר <button type="button" class="link-btn" id="clear-filters">לנקות את הסינון</button>.</li>';
      var clear = $("#clear-filters");
      if (clear) clear.addEventListener("click", function () {
        state.cat = state.color = state.scent = "all";
        $all(".chip", filters).forEach(function (c) { c.setAttribute("aria-pressed", String(c.dataset.value === "all")); });
        render();
      });
    }
    render();
  }

  // ---------- product page ----------
  function initProduct(data) {
    var root = $("#product");
    if (!root) return;

    function render() {
      var id = decodeURIComponent(location.hash.slice(1)) || lastProduct();
      var p = data.products.filter(function (x) { return x.id === id; })[0] || data.products[0];
      if (!p) { root.innerHTML = '<p class="empty-state">המוצר לא נמצא.</p>'; return; }
      document.title = p.name + " | ORÉ";
      var images = p.images && p.images.length ? p.images : [null];

      function optionSet(name, label, values) {
        if (!values || !values.length) return "";
        return '<fieldset class="option-set"><legend>' + esc(label) + "</legend><div class=\"chips\">" +
          values.map(function (v, i) {
            var val = typeof v === "string" ? v : v.label;
            var extra = typeof v === "string" ? "" : ", " + money(v.price);
            var idAttr = "opt-" + name + "-" + i;
            return '<input class="chip-input" type="radio" name="' + name + '" id="' + idAttr + '" value="' + esc(val) + '"' + (i === 0 ? " checked" : "") + '>' +
              '<label class="chip" for="' + idAttr + '">' + esc(val) + extra + "</label>";
          }).join("") + "</div></fieldset>";
      }

      var cat = data.settings.categories.filter(function (c) { return c.id === p.category; })[0];
      var available = inStock(p);
      root.innerHTML =
        '<nav class="crumbs" aria-label="מיקום באתר"><a href="index.html">דף הבית</a><span aria-hidden="true">/</span><a href="shop.html">החנות</a>' +
          (cat ? '<span aria-hidden="true">/</span><a href="shop.html#' + esc(cat.id) + '">' + esc(cat.label) + "</a>" : "") + "</nav>" +
        '<div class="pdp">' +
          '<div class="gallery">' +
            '<div class="gallery__main ' + plateClass(p) + '" id="gallery-main"' + (p.images && p.images.length ? "" : ' role="img" aria-label="' + esc(p.name) + '"') + ">" + mediaHTML(p, 0) + "</div>" +
            (images.length > 1 ? '<div class="gallery__thumbs" role="group" aria-label="תמונות נוספות">' + images.map(function (src, i) {
              return '<button type="button" class="thumb" data-index="' + i + '" aria-pressed="' + (i === 0) + '"><img src="' + esc(src) + '" alt="תמונה ' + (i + 1) + " של " + esc(p.name) + '"></button>';
            }).join("") + "</div>" : "") +
          "</div>" +
          '<div class="pdp__info">' +
            "<h1>" + esc(p.name) + "</h1>" +
            '<p class="pdp__short">' + esc(p.short || "") + "</p>" +
            '<p class="pdp__price" id="pdp-price">' + money(priceOf(p, p.sizes && p.sizes[0] && p.sizes[0].label)) + "</p>" +
            '<form class="pdp__form" id="pdp-form" novalidate>' +
              optionSet("size", "גודל", p.sizes) +
              optionSet("color", "צבע", p.colors) +
              optionSet("scent", "ריח", p.scents) +
              '<div class="pdp__buy">' +
                '<div class="qty" role="group" aria-label="כמות">' +
                  '<button type="button" class="qty__btn" data-step="1" aria-label="הוספת יחידה">+</button>' +
                  '<input type="number" id="pdp-qty" class="qty__input" value="1" min="1" max="20" inputmode="numeric" aria-label="כמות">' +
                  '<button type="button" class="qty__btn" data-step="-1" aria-label="הורדת יחידה">−</button>' +
                "</div>" +
                '<button class="btn btn--block" type="submit"' + (available ? "" : " disabled") + ">" + (available ? "הוספה לסל" : "אזל מהמלאי") + "</button>" +
              "</div>" +
            "</form>" +
            '<ul class="pdp__perks">' +
              "<li>משלוח חינם בהזמנה מעל " + money(data.settings.freeShippingThreshold) + "</li>" +
              "<li>מגיע בקופסה אטומה, מוכן למתנה</li>" +
              "<li>אפשר להוסיף ברכה אישית בסל</li>" +
            "</ul>" +
            '<div class="faq pdp__details">' +
              "<details open><summary>תיאור</summary><div><p>" + esc(p.description || "") + "</p></div></details>" +
              "<details><summary>שימוש ובטיחות</summary><div><ul class=\"bullets\">" + (data.settings.safety || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul></div></details>" +
              "<details><summary>משלוחים ואיסוף</summary><div><ul class=\"bullets\">" + data.settings.shipping.map(function (m) {
                return "<li>" + esc(m.label) + ": " + (m.price ? money(m.price) : "ללא עלות") + (m.freeOverThreshold ? " (חינם מעל " + money(data.settings.freeShippingThreshold) + ")" : "") + "</li>";
              }).join("") + "</ul></div></details>" +
            "</div>" +
          "</div>" +
        "</div>";

      // gallery
      $all(".thumb", root).forEach(function (t) {
        t.addEventListener("click", function () {
          var i = +t.dataset.index;
          $("#gallery-main").innerHTML = mediaHTML(p, i);
          $all(".thumb", root).forEach(function (o) { o.setAttribute("aria-pressed", String(o === t)); });
        });
      });

      // size → price
      var form = $("#pdp-form");
      form.addEventListener("change", function (e) {
        if (e.target.name === "size") $("#pdp-price").textContent = money(priceOf(p, e.target.value));
      });
      // qty
      var qty = $("#pdp-qty");
      $all(".qty__btn", form).forEach(function (b) {
        b.addEventListener("click", function () {
          qty.value = Math.max(1, Math.min(20, (parseInt(qty.value, 10) || 1) + +b.dataset.step));
        });
      });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!available) return;
        var get = function (n) { var el = form.querySelector('input[name="' + n + '"]:checked'); return el ? el.value : ""; };
        var size = get("size"), color = get("color"), scent = get("scent");
        var q = Math.max(1, Math.min(20, parseInt(qty.value, 10) || 1));
        addToCart({
          key: [p.id, size, color, scent].join("|"),
          id: p.id, name: p.name, size: size, color: color, scent: scent,
          price: priceOf(p, size), qty: q
        });
        toast("<span>" + esc(p.name) + " נוסף לסל</span> <a href=\"cart.html\">למעבר לסל</a>");
      });

      // related
      var rel = $("#related");
      if (rel) rel.innerHTML = data.products.filter(function (x) { return x.id !== p.id; }).slice(0, 4).map(cardHTML).join("");
    }

    render();
    window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); });
  }

  // ---------- cart page ----------
  function initCart(data) {
    var root = $("#cart");
    if (!root) return;
    var s = data.settings;
    var byId = {};
    data.products.forEach(function (p) { byId[p.id] = p; });
    var coupon = null;
    var form = $("#checkout-form");

    // shipping options
    $("#shipping-options").innerHTML = s.shipping.map(function (m, i) {
      return '<div class="radio-card"><input type="radio" name="shipping" id="ship-' + esc(m.id) + '" value="' + esc(m.id) + '"' + (i === 0 ? " checked" : "") + ">" +
        '<label for="ship-' + esc(m.id) + '"><span class="radio-card__title">' + esc(m.label) + '</span><span class="radio-card__price" data-ship-price="' + esc(m.id) + '"></span>' +
        (m.note ? '<span class="radio-card__note">' + esc(m.note) + "</span>" : "") + "</label></div>";
    }).join("");

    function method() {
      var id = (form.querySelector('input[name="shipping"]:checked') || {}).value;
      return s.shipping.filter(function (m) { return m.id === id; })[0] || s.shipping[0];
    }

    function totals(items) {
      var subtotal = items.reduce(function (n, i) { return n + i.price * i.qty; }, 0);
      var discount = 0;
      if (coupon) discount = coupon.type === "percent" ? Math.round(subtotal * coupon.value) / 100 : Math.min(subtotal, coupon.value);
      var after = subtotal - discount;
      var m = method();
      var free = m.freeOverThreshold && after >= s.freeShippingThreshold;
      var ship = free ? 0 : m.price;
      return { subtotal: subtotal, discount: discount, after: after, ship: ship, free: free, total: after + ship, method: m };
    }

    function refreshPrices(items) {
      // keep prices in sync with the catalogue
      items.forEach(function (i) {
        var p = byId[i.id];
        if (p) i.price = priceOf(p, i.size);
      });
      return items.filter(function (i) { return byId[i.id]; });
    }

    function render() {
      var items = refreshPrices(readCart());
      var empty = !items.length;
      $("#cart-empty").hidden = !empty;
      $("#cart-full").hidden = empty;
      if (empty) return;

      $("#cart-items").innerHTML = items.map(function (i, idx) {
        var p = byId[i.id];
        var opts = [i.size, i.color, i.scent].filter(Boolean).join(", ");
        return '<li class="line">' +
          '<a class="line__media ' + plateClass(p) + '" href="product.html#' + esc(p.id) + '" tabindex="-1" aria-hidden="true">' + mediaHTML(p, 0, true) + "</a>" +
          '<div class="line__info"><a class="line__name" href="product.html#' + esc(p.id) + '">' + esc(i.name) + "</a>" +
            (opts ? '<p class="line__opts">' + esc(opts) + "</p>" : "") +
            '<p class="line__unit">' + money(i.price) + " ליחידה</p>" +
            '<div class="line__actions">' +
              '<div class="qty qty--sm" role="group" aria-label="כמות של ' + esc(i.name) + '">' +
                '<button type="button" class="qty__btn" data-idx="' + idx + '" data-step="1" aria-label="הוספת יחידה">+</button>' +
                '<span class="qty__value" aria-live="polite">' + i.qty + "</span>" +
                '<button type="button" class="qty__btn" data-idx="' + idx + '" data-step="-1" aria-label="הורדת יחידה">−</button>' +
              "</div>" +
              '<button type="button" class="link-btn" data-remove="' + idx + '">הסרה</button>' +
            "</div>" +
          "</div>" +
          '<p class="line__total">' + money(i.price * i.qty) + "</p>" +
        "</li>";
      }).join("");

      var t = totals(items);
      s.shipping.forEach(function (m) {
        var el = form.querySelector('[data-ship-price="' + m.id + '"]');
        if (!el) return;
        var free = m.freeOverThreshold && t.after >= s.freeShippingThreshold;
        el.textContent = free ? "חינם" : (m.price ? money(m.price) : "ללא עלות");
      });
      var gap = s.freeShippingThreshold - t.after;
      $("#free-ship-note").textContent = gap > 0 ? "חסרים עוד " + money(gap) + " למשלוח חינם" : "ההזמנה שלך זכאית למשלוח חינם";
      $("#free-ship-bar").style.setProperty("--p", Math.min(100, (t.after / s.freeShippingThreshold) * 100) + "%");

      $("#sum-subtotal").textContent = money(t.subtotal);
      $("#sum-discount-row").hidden = !t.discount;
      $("#sum-discount").textContent = "−" + money(t.discount);
      $("#sum-shipping").textContent = t.ship ? money(t.ship) : (t.method.price || t.free ? "חינם" : "ללא עלות");
      $("#sum-total").textContent = money(t.total);
      $("#address-fields").hidden = !t.method.needsAddress;
      $all("#address-fields input").forEach(function (inp) { inp.required = !!t.method.needsAddress; });
      $("#wa-panel").hidden = true;
    }

    $("#cart-items").addEventListener("click", function (e) {
      var items = readCart();
      var b = e.target.closest("[data-step]");
      var r = e.target.closest("[data-remove]");
      if (b) {
        var it = items[+b.dataset.idx];
        it.qty = Math.max(1, Math.min(20, it.qty + +b.dataset.step));
        writeCart(items);
      } else if (r) {
        items.splice(+r.dataset.remove, 1);
        writeCart(items);
        $("#cart-status").textContent = "הפריט הוסר מהסל";
      }
    });
    form.addEventListener("change", function (e) { if (e.target.name === "shipping") render(); });
    document.addEventListener("cart:change", render);

    // coupon
    $("#coupon-apply").addEventListener("click", function () {
      var code = $("#coupon").value.trim().toUpperCase();
      var msg = $("#coupon-msg");
      var c = (s.coupons || []).filter(function (x) { return x.code.toUpperCase() === code; })[0];
      if (!code) { coupon = null; msg.textContent = "הקלידי קוד קופון."; }
      else if (!c) { coupon = null; msg.textContent = "הקוד " + code + " לא נמצא. בדקי את האיות ונסי שוב."; }
      else { coupon = c; msg.textContent = "הקופון הופעל: " + c.label; }
      render();
    });

    // checkout → WhatsApp
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var invalid = $all("input[required], textarea[required]", form).filter(function (el) { return !el.checkValidity(); });
      $all(".field-error", form).forEach(function (el) { el.textContent = ""; });
      if (invalid.length) {
        invalid.forEach(function (el) {
          var err = form.querySelector('[data-error-for="' + el.id + '"]');
          if (err) err.textContent = el.type === "tel" ? "צריך מספר טלפון תקין, למשל 050-1234567." : "צריך למלא את השדה הזה.";
        });
        invalid[0].focus();
        return;
      }
      var items = refreshPrices(readCart());
      if (!items.length) return;
      var t = totals(items);
      var val = function (id) { var el = $("#" + id); return el ? el.value.trim() : ""; };
      var lines = [];
      var d = new Date();
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      var orderNo = "ORE-" + pad(d.getDate()) + pad(d.getMonth() + 1) + "-" + (100 + Math.floor(Math.random() * 900));
      lines.push("שלום! אני רוצה להזמין מ-ORÉ:");
      lines.push("מספר הזמנה: " + orderNo);
      lines.push("");
      items.forEach(function (i) {
        var opts = [i.size, i.color, i.scent].filter(Boolean).join(", ");
        lines.push("• " + i.name + (opts ? " (" + opts + ")" : "") + " × " + i.qty + " = " + money(i.price * i.qty));
      });
      lines.push("");
      lines.push("סכום ביניים: " + money(t.subtotal));
      if (t.discount) lines.push("הנחה (" + coupon.code + "): −" + money(t.discount));
      lines.push("משלוח – " + t.method.label + ": " + (t.ship ? money(t.ship) : "חינם"));
      lines.push("סה\"כ לתשלום: " + money(t.total));
      lines.push("");
      lines.push("שם: " + val("c-name"));
      lines.push("טלפון: " + val("c-phone"));
      if (t.method.needsAddress) lines.push("כתובת: " + val("c-street") + ", " + val("c-city"));
      if (val("c-gift")) { lines.push(""); lines.push("ברכה למתנה: " + val("c-gift")); }
      if (val("c-notes")) { lines.push(""); lines.push("הערות: " + val("c-notes")); }
      var url = "https://wa.me/" + s.whatsapp + "?text=" + encodeURIComponent(lines.join("\n"));
      var panel = $("#wa-panel");
      $("#wa-link").href = url;
      $("#wa-preview").textContent = lines.join("\n");
      $("#wa-order-no").textContent = orderNo;
      panel.hidden = false;
      panel.scrollIntoView({ behavior: "smooth", block: "center" });
      $("#wa-link").focus({ preventScroll: true });
    });
    $("#cart-clear").addEventListener("click", function () {
      writeCart([]);
      $("#cart-status").textContent = "הסל רוקן";
    });

    render();
  }

  // Remember which product was clicked, in case the link's #id is dropped on the way
  // (some previewers strip it when moving between pages).
  var LAST_KEY = "ore-last-product";
  var memoryLast = "";
  function lastProduct() {
    try { return localStorage.getItem(LAST_KEY) || memoryLast; } catch (e) { return memoryLast; }
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href*="product.html#"]');
    if (!a) return;
    memoryLast = decodeURIComponent(a.getAttribute("href").split("#")[1] || "");
    try { localStorage.setItem(LAST_KEY, memoryLast); } catch (err) { /* private mode */ }
  }, true);

  // ---------- boot ----------
  updateCartCount();
  loadAll().then(function (data) {
    initContact(data.settings);
    initFeatured(data);
    initShop(data);
    initProduct(data);
    initCart(data);
  }).catch(function () {
    loadError($("#featured-products") || $("#shop-grid") || $("#product") || $("#cart"));
  });
})();
