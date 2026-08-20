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

  function buildWheel(id, items, selectedValue, onChange) {
    const el = document.getElementById(id);
    el.innerHTML = "";
    el._items = items;
    el._onChange = onChange;

    const track = document.createElement("div");
    track.style.paddingTop = ITEM_H + "px";
    track.style.paddingBottom = ITEM_H + "px";

    items.forEach((it) => {
      const div = document.createElement("div");
      div.className = "wheel-item";
      div.textContent = it.label;
      track.appendChild(div);
    });
    el.appendChild(track);

    let selIdx = items.findIndex((it) => it.value === selectedValue);
    if (selIdx < 0) selIdx = 0;
    el.scrollTop = selIdx * ITEM_H;
    markSelected(el, selIdx);

    let debounceTimer;
    el.onscroll = () => {
      const idx = clampIdx(el, Math.round(el.scrollTop / ITEM_H));
      markSelected(el, idx);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => settleWheel(el), 120);
    };
  }

  function clampIdx(el, idx) {
    return Math.max(0, Math.min(el._items.length - 1, idx));
  }

  function markSelected(el, idx) {
    const items = el.querySelectorAll(".wheel-item");
    items.forEach((c, i) => c.classList.toggle("is-selected", i === idx));
  }

  function settleWheel(el) {
    const idx = clampIdx(el, Math.round(el.scrollTop / ITEM_H));
    el.scrollTo({ top: idx * ITEM_H, behavior: "smooth" });
    markSelected(el, idx);
    el._onChange(el._items[idx].value);
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

    document.getElementById("rv-viewer").src = MODELS_BASE + row.glb;
    document.getElementById("rv-od1").textContent = row.od1.toFixed(1);
    document.getElementById("rv-od2").textContent = row.od2.toFixed(1);
    document.getElementById("rv-len").textContent = row.len.toFixed(1);
    document.getElementById("rv-p").textContent =
      row.p != null ? row.p.toFixed(2) : window.t ? window.t("n/a", "yok") : "n/a";

    const dl = document.getElementById("rv-download");
    dl.href = STEP_BASE + row.step;
    dl.setAttribute("download", row.step);
  }

  async function init() {
    const res = await fetch("/reducer/manifest.json");
    manifest = await res.json();

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
