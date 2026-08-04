const yearElement = document.getElementById("year");
const revealElements = document.querySelectorAll("[data-reveal]");

if (yearElement) {
  yearElement.textContent = `© ${new Date().getFullYear()} Ahmet Hamza Mülayim`;
}

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 }
  );

  revealElements.forEach((element) => observer.observe(element));
} else {
  revealElements.forEach((element) => element.classList.add("visible"));
}

const contactForm = document.getElementById("contact-form");
if (contactForm) {
  const status = contactForm.querySelector(".form-status");
  const submitBtn = contactForm.querySelector("button[type=submit]");
  const resultFrame = document.querySelector('iframe[name="contact-frame"]');
  const t = window.t || ((en) => en);
  const maxAttachBytes = 10 * 1024 * 1024;
  let submitted = false;

  // File uploads only work via a real multipart POST (FormSubmit's AJAX/JSON
  // endpoint rejects them), so this submits natively into a hidden iframe
  // instead of using fetch. That means the response body can't be read back —
  // "load" fires the same for a FormSubmit success page as an error page, so
  // the confirmation below is optimistic, not a verified delivery receipt.
  contactForm.addEventListener("submit", (event) => {
    if (contactForm.elements._honey.value) {
      event.preventDefault();
      return;
    }

    const attachBytes = Array.from(contactForm.elements.attachment.files).reduce(
      (sum, file) => sum + file.size,
      0
    );
    if (attachBytes > maxAttachBytes) {
      event.preventDefault();
      status.className = "form-status err";
      status.textContent = t("Attachment too large — 10MB max.", "Ek çok büyük — en fazla 10MB.");
      return;
    }

    submitted = true;
    submitBtn.disabled = true;
    status.className = "form-status";
    status.textContent = t("Sending…", "Gönderiliyor…");
  });

  resultFrame.addEventListener("load", () => {
    if (!submitted) return;
    submitted = false;
    submitBtn.disabled = false;
    status.className = "form-status ok";
    status.textContent = t("Sent — I'll get back to you soon.", "Gönderildi — en kısa sürede dönüş yapacağım.");
    contactForm.reset();
  });
}

// Homepage hero tiles: swap the static blurb for a live number once it
// arrives. Feeds through the existing i18n dict/apply so language toggling
// still works after the live text lands, instead of just setting textContent.
function setLiveTileText(id, i18nKey, en, tr) {
  const el = document.getElementById(id);
  if (!el) return;
  el.dataset.orig = en;
  (window.I18N || (window.I18N = {}))[i18nKey] = tr;
  if (window.setLang && window.getLang) window.setLang(window.getLang());
}

const globeNote = document.getElementById("live-globe-note");
if (globeNote) {
  fetch("https://civil-nightingale-6719.ahmethamzamulayim-png.deno.net/api/states")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data) return;
      const count = (data.states || []).filter(
        (s) => s[1] && s[1].trim().startsWith("THY") && !s[8] && s[5] != null && s[6] != null
      ).length;
      if (count > 0) {
        setLiveTileText(
          "live-globe-note",
          "tile.globe.note",
          `${count} flights on a 3D globe, live`,
          `3B kürede ${count} uçuş, canlı`
        );
      }
    })
    .catch(() => {});
}

const istNote = document.getElementById("live-ist-note");
if (istNote) {
  fetch("summary.json", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || !data.delay_known) return;
      const nEN = data.delay_known.toLocaleString("en-US");
      const nTR = data.delay_known.toLocaleString("tr-TR");
      setLiveTileText("live-ist-note", "tile.ist.note", `${nEN} flown departures`, `${nTR} uçan kalkış`);
    })
    .catch(() => {});
}

// Easter egg: type "concorde" anywhere on the site to fly a plane across the screen.
(() => {
  const TARGET = "concorde";
  let buffer = "";

  document.addEventListener("keydown", (event) => {
    const active = document.activeElement;
    const typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
    if (typing || event.key.length !== 1) return;

    buffer = (buffer + event.key.toLowerCase()).slice(-TARGET.length);
    if (buffer === TARGET) {
      buffer = "";
      flyConcorde();
    }
  });

  function flyConcorde() {
    const plane = document.createElement("div");
    plane.className = "easter-plane";
    // Concorde silhouette: needle nose, delta wing, tail fin — nose points right (+x)
    plane.innerHTML =
      '<svg viewBox="0 0 200 60" fill="currentColor" width="100%" height="100%">' +
      '<path d="M10 30 L10 22 Q100 17 185 27 L198 30 L185 33 Q120 38 60 36 L10 34 Z"/>' +
      '<path d="M55 32 L145 29 L105 48 Z"/>' +
      '<path d="M14 24 L14 6 L28 25 Z"/>' +
      "</svg>";
    const boom = document.createElement("div");
    boom.className = "easter-boom";
    document.body.append(plane, boom);
    setTimeout(() => {
      plane.remove();
      boom.remove();
    }, 2800);
  }
})();

// Per-page custom cursor: <body data-cursor="din|bearing|plane">. Bearing mode
// spins with momentum — angular velocity builds from horizontal mouse speed
// and decays each frame, like a real wheel coasting down, instead of
// snapping straight to a rotation.
(() => {
  const mode = document.body.dataset.cursor;
  if (!mode || !window.matchMedia("(pointer: fine)").matches) return;

  const icons = {
    plane:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>',
    bearing:
      '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="16" cy="16" r="14"/><circle cx="16" cy="16" r="6"/>' +
      '<g fill="currentColor" stroke="none">' +
      '<circle cx="26" cy="16" r="1.8"/><circle cx="23.07" cy="23.07" r="1.8"/>' +
      '<circle cx="16" cy="26" r="1.8"/><circle cx="8.93" cy="23.07" r="1.8"/>' +
      '<circle cx="6" cy="16" r="1.8"/><circle cx="8.93" cy="8.93" r="1.8"/>' +
      '<circle cx="16" cy="6" r="1.8"/><circle cx="23.07" cy="8.93" r="1.8"/>' +
      "</g></svg>",
    din:
      '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M21 16 L18.5 20.33 L13.5 20.33 L11 16 L13.5 11.67 L18.5 11.67 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  };
  const icon = icons[mode];
  if (!icon) return;

  const cursorEl = document.createElement("div");
  cursorEl.className = "custom-cursor";
  cursorEl.dataset.mode = mode;
  cursorEl.innerHTML = icon;
  document.body.appendChild(cursorEl);

  const spinEnabled = mode === "bearing" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let x = innerWidth / 2,
    y = innerHeight / 2,
    lastX = x,
    lastT = performance.now(),
    angle = 0,
    angVel = 0,
    stretch = 1;

  document.addEventListener("mousemove", (event) => {
    cursorEl.classList.add("active");
    if (spinEnabled) {
      const now = performance.now();
      const kick = ((event.clientX - lastX) / Math.max(now - lastT, 1)) * 6;
      angVel = Math.max(-25, Math.min(25, angVel + Math.max(-15, Math.min(15, kick))));
      lastT = now;
    }
    x = event.clientX;
    y = event.clientY;
    lastX = event.clientX;
  });

  // webOS Magic Remote-style squash/stretch: scrolling elongates the bearing
  // vertically, like it's rolling on the scrollbar, easing back to round after.
  if (spinEnabled) {
    window.addEventListener("wheel", () => { stretch = 1.6; }, { passive: true });
  }

  (function tick() {
    if (spinEnabled) {
      angle += angVel;
      angVel *= 0.94;
      stretch += (1 - stretch) * 0.12;
    }
    const scale = stretch !== 1 ? ` scale(${(2 - stretch).toFixed(3)}, ${stretch.toFixed(3)})` : "";
    cursorEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${angle}deg)${scale}`;
    requestAnimationFrame(tick);
  })();
})();
