/* Reducer configurator: cascading wheel pickers (type -> large DN -> small
   DN, each filtered by the previous), a model-viewer 3D preview, and a
   download link -- all driven by manifest.json, which lists exactly the
   128 real, validated parts. No option here can select a combination that
   doesn't actually exist in the library. */
(function () {
  "use strict";

  const MODELS_BASE = "/reducer/models/";
  const STEP_BASE =
    "https://raw.githubusercontent.com/ahmethamzamulayim-png/pipe-reducer-generator/main/library/step/";
  const ITEM_H = 44;
  const isTr = () => window.getLang && window.getLang() === "tr";
  const nf = (v, d = 1) =>
    Number(v).toLocaleString(isTr() ? "tr-TR" : "en-US", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  const TYPE_LABELS = {
    concentric: () => (window.t ? window.t("Concentric", "Konsantrik") : "Concentric"),
    eccentric: () => (window.t ? window.t("Eccentric", "Eksantrik") : "Eccentric"),
  };

  let manifest = [];
  const state = { t: null, l: null, s: null };

  function uniqueSorted(arr) {
    return [...new Set(arr)].sort((a, b) => a - b);
  }

  function largesFor(t) {
    return uniqueSorted(manifest.filter((r) => r.t === t).map((r) => r.l));
  }

  function smallsFor(t, l) {
    return uniqueSorted(manifest.filter((r) => r.t === t && r.l === l).map((r) => r.s));
  }

  function dnItems(list) {
    return list.map((dn) => ({ value: dn, label: "DN" + dn }));
  }

  function selectIdx(el, idx, smooth) {
    const clamped = clampIdx(el, idx);
    el._selIdx = clamped;
    if (smooth) {
      el.scrollTo({ top: clamped * ITEM_H, behavior: "smooth" });
    } else {
      el.scrollTop = clamped * ITEM_H;
    }
    markSelected(el, clamped);
    el._onChange(el._items[clamped].value);
  }

  function buildWheel(id, items, selectedValue, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = "";
    el._items = items;
    el._onChange = onChange;
    el.setAttribute("role", "listbox");
    el.tabIndex = 0;

    const track = document.createElement("div");
    track.style.paddingTop = ITEM_H + "px";
    track.style.paddingBottom = ITEM_H + "px";

    items.forEach((it, idx) => {
      const div = document.createElement("div");
      div.className = "wheel-item";
      div.setAttribute("role", "option");
      div.textContent = it.label;
      div.addEventListener("click", () => {
        clearTimeout(el._debounceTimer);
        selectIdx(el, idx, true);
      });
      track.appendChild(div);
    });
    el.appendChild(track);

    let selIdx = items.findIndex((it) => it.value === selectedValue);
    if (selIdx < 0) selIdx = 0;
    el._selIdx = selIdx;
    el.scrollTop = selIdx * ITEM_H;
    markSelected(el, selIdx);

    el.onscroll = () => {
      const idx = clampIdx(el, Math.round(el.scrollTop / ITEM_H));
      markSelected(el, idx);
      clearTimeout(el._debounceTimer);
      el._debounceTimer = setTimeout(() => settleWheel(el), 120);
    };

    el.onkeydown = (e) => {
      const cur = typeof el._selIdx === "number" ? el._selIdx : clampIdx(el, Math.round(el.scrollTop / ITEM_H));
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectIdx(el, cur + 1, true);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectIdx(el, cur - 1, true);
      } else if (e.key === "Home") {
        e.preventDefault();
        selectIdx(el, 0, true);
      } else if (e.key === "End") {
        e.preventDefault();
        selectIdx(el, el._items.length - 1, true);
      }
    };
  }

  function clampIdx(el, idx) {
    return Math.max(0, Math.min(el._items.length - 1, idx));
  }

  function markSelected(el, idx) {
    const items = el.querySelectorAll(".wheel-item");
    items.forEach((c, i) => {
      const sel = i === idx;
      c.classList.toggle("is-selected", sel);
      c.setAttribute("aria-selected", sel ? "true" : "false");
    });
  }

  function settleWheel(el) {
    const idx = clampIdx(el, Math.round(el.scrollTop / ITEM_H));
    if (idx === el._selIdx) {
      el.scrollTo({ top: idx * ITEM_H, behavior: "smooth" });
      return;
    }
    selectIdx(el, idx, true);
  }

  function onTypeChange(t) {
    state.t = t;
    const larges = largesFor(state.t);
    if (!larges.includes(state.l)) state.l = larges[0];
    buildWheel("wheel-large", dnItems(larges), state.l, onLargeChange);
    const smalls = smallsFor(state.t, state.l);
    if (!smalls.includes(state.s)) state.s = smalls[0];
    buildWheel("wheel-small", dnItems(smalls), state.s, onSmallChange);
    updateViewer();
  }

  function onLargeChange(l) {
    state.l = l;
    const smalls = smallsFor(state.t, state.l);
    if (!smalls.includes(state.s)) state.s = smalls[0];
    buildWheel("wheel-small", dnItems(smalls), state.s, onSmallChange);
    updateViewer();
  }

  function onSmallChange(s) {
    state.s = s;
    updateViewer();
  }

  function updateViewer() {
    const row = manifest.find((r) => r.t === state.t && r.l === state.l && r.s === state.s);
    if (!row) return;

    const viewer = document.getElementById("rv-viewer");
    viewer.src = MODELS_BASE + row.glb;
    const typeLabel = (TYPE_LABELS[row.t] || (() => row.t))();
    viewer.setAttribute(
      "alt",
      window.t
        ? window.t(
            `${typeLabel} pipe reducer DN${row.l} to DN${row.s} 3D model`,
            `${typeLabel} boru redüksiyonu DN${row.l} - DN${row.s} 3B modeli`
          )
        : `${typeLabel} pipe reducer DN${row.l} to DN${row.s} 3D model`
    );
    document.getElementById("rv-od1").textContent = nf(row.od1, 1);
    document.getElementById("rv-od2").textContent = nf(row.od2, 1);
    document.getElementById("rv-len").textContent = nf(row.len, 1);
    document.getElementById("rv-p").textContent =
      row.p != null ? nf(row.p, 2) : window.t ? window.t("n/a", "yok") : "n/a";

    const dl = document.getElementById("rv-download");
    dl.href = STEP_BASE + row.step;
    dl.setAttribute("download", row.step);
  }

  async function init() {
    try {
      const res = await fetch("/reducer/manifest.json");
      if (!res.ok) throw new Error("manifest HTTP " + res.status);
      manifest = await res.json();
    } catch {
      const dl = document.getElementById("rv-download");
      if (dl) {
        dl.textContent = window.t
          ? window.t("Library unavailable — view on GitHub", "Kütüphane yüklenemedi — GitHub'da gör")
          : "Library unavailable — view on GitHub";
        dl.href = "https://github.com/ahmethamzamulayim-png/pipe-reducer-generator";
        dl.removeAttribute("download");
      }
      return;
    }

    const types = uniqueSortedStrings(manifest.map((r) => r.t));
    state.t = types[0];
    const larges = largesFor(state.t);
    state.l = larges[0];
    const smalls = smallsFor(state.t, state.l);
    state.s = smalls[0];

    buildWheel(
      "wheel-type",
      types.map((t) => ({ value: t, label: (TYPE_LABELS[t] || (() => t))() })),
      state.t,
      onTypeChange
    );
    buildWheel("wheel-large", dnItems(larges), state.l, onLargeChange);
    buildWheel("wheel-small", dnItems(smalls), state.s, onSmallChange);

    updateViewer();
  }

  function uniqueSortedStrings(arr) {
    return [...new Set(arr)].sort();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
