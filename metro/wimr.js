// WhereisMyRide page: fills every [data-k] number from /metro/wimr.json + /metro/tube.json, draws the charts.
// Text via t() from /i18n.js. Numbers are formatted per language (decimal comma in Turkish).
const tt = (en, tr) => (window.t ? t(en, tr) : en);
const TR = () => window.getLang && getLang() === "tr";
const nf = (v, d = 0) => Number(v).toLocaleString(TR() ? "tr-TR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const KMH = () => (TR() ? "km/s" : "km/h");

const [W, TB, BUS] = await Promise.all(["/metro/wimr.json", "/metro/tube.json", "/metro/bus.json"].map((u) => fetch(u).then((r) => r.json())));
const F1 = BUS.lines.frequent["1"], F2 = BUS.lines.frequent["2"], I1 = BUS.lines.infrequent["1"];
const S = W.sample;
const col = (name) => S.rows.map((r) => r[S.cols.indexOf(name)]);
const tS = col("t");

// derived figures used in the text (computed here, so the page can't drift from the data)
const MU0 = 4e-7 * Math.PI;
const derived = {
  "derived.I_amp": (2 * Math.PI * 1.0 * W.magnet.push_uT.median * 1e-6) / MU0, // I = 2 pi r B / mu0 at r = 1 m
  "derived.q80": 0.5 * 1.2 * (80 / 3.6) ** 2,
  "derived.q80_m": (0.5 * 1.2 * (80 / 3.6) ** 2) / (1.2 * 9.81),
  "derived.lin_pct": (100 * S.dist_linear_m) / S.track_m,
  "derived.repeat": TB.height_repeat_m,
  "derived.km": TB.stations[TB.stations.length - 1].s / 1000,
  "derived.drop_jkg": 9.81 * Math.max(...TB.stretches.map((s) => -s.dz_m)),
  // bus chapter: percentages and the feedback model's predicted pair slope e^(K beta)
  "bus.pct.f1s": 100 * F1.bunched_start, "bus.pct.f1e": 100 * F1.bunched_end, "bus.pct.i1e": 100 * I1.bunched_end,
  "bus.pct.direct": 100 * F1.direct, "bus.pct.direct_lo": 100 * F1.direct_lo, "bus.pct.direct_hi": 100 * F1.direct_hi,
  "bus.pct.fb1": 100 * F1.share.feedback, "bus.pct.fb2": 100 * F2.share.feedback, "bus.pct.ov2": 100 * F2.overtook,
  "bus.pred.f1": Math.exp(F1.beta_total), "bus.pred.f2": Math.exp(F2.beta_total),
};
function get(path) {
  if (path in derived) return derived[path];
  const [root, rest] = path.startsWith("bus.") ? [BUS, path.slice(4)] : [W, path];
  return rest.split(".").reduce((o, k) => (o == null ? o : o[k]), root);
}
document.querySelectorAll("[data-k]").forEach((el) => {
  const v = get(el.dataset.k);
  if (typeof v === "string") { el.textContent = v; return; }
  if (v == null || Number.isNaN(v)) return;
  const d = +(el.dataset.d || 0);
  el.textContent = (el.dataset.sign && v > 0 ? "+" : "") + nf(v, d);
});
document.querySelectorAll("[data-unit=kmh]").forEach((el) => (el.textContent = KMH()));

// ---------- charts ----------
const CW = 760, L = 56, R = 18;
const xs = (t) => L + (t / tS[tS.length - 1]) * (CW - L - R);
function frame(H, T, B, lo, hi, step, unit, fmt = (v) => nf(v)) {
  const ys = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let g = "";
  for (let v = lo; v <= hi + 1e-9; v += step)
    g += `<line x1="${L}" x2="${CW - R}" y1="${ys(v)}" y2="${ys(v)}" class="${Math.abs(v) < 1e-9 ? "base" : "grid"}"/><text x="${L - 8}" y="${ys(v) + 4}" class="ax" text-anchor="end">${fmt(v)}</text>`;
  g += `<text x="${L - 8}" y="${T - 10}" class="ax" text-anchor="end">${unit}</text>`;
  return { g, ys };
}
function xAxis(H, B) {
  let g = "";
  for (let s = 0; s <= tS[tS.length - 1]; s += 20) g += `<text x="${xs(s)}" y="${H - B + 18}" class="ax" text-anchor="middle">${s} s</text>`;
  return g;
}
const line = (ys, vals, cls, color) =>
  `<polyline class="${cls}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="${vals.map((v, i) => `${xs(tS[i]).toFixed(1)},${ys(v).toFixed(1)}`).join(" ")}"/>`;
function hover(H, T, B, fmtRow) {
  let g = "";
  const n = tS.length, stepN = Math.max(1, Math.round(n / 64));
  for (let i = 0; i < n; i += stepN) {
    const x0 = xs(tS[i]), x1 = xs(tS[Math.min(n - 1, i + stepN)]);
    g += `<rect x="${x0}" y="${T}" width="${Math.max(1, x1 - x0)}" height="${H - T - B}" fill="transparent"><title>${fmtRow(i)}</title></rect>`;
  }
  return g;
}

// 1. speed: raw accelerometer pinned at both ends vs Android's linear acceleration as-is; the line's 80 km/h limit
(function speed() {
  const H = 250, T = 22, B = 30;
  const v = col("v_kmh"), vl = col("v_linear_kmh");
  const { g, ys } = frame(H, T, B, 0, 100, 25, KMH());
  let s = g + xAxis(H, B);
  s += `<line x1="${L}" x2="${CW - R}" y1="${ys(80)}" y2="${ys(80)}" class="limit"/><text x="${L + 6}" y="${ys(80) - 6}" class="lbl muted">${tt("line's top speed, 80", "hattın azami hızı, 80")}</text>`;
  s += line(ys, vl, "", "#b08a1e") + line(ys, v, "", "#1d4ed8");
  const im = v.indexOf(Math.max(...v));
  s += `<text x="${xs(tS[im]) - 10}" y="${ys(v[im]) - 10}" class="lbl" text-anchor="end">${tt("raw, pinned to both stops + distance", "ham, iki duruşa + mesafeye sabitli")}</text>`;
  s += `<text x="${xs(tS[Math.round(tS.length * 0.55)])}" y="${ys(Math.max(...vl.slice(Math.round(tS.length * 0.5)))) - 10}" class="lbl muted">${tt("Android's linear acceleration, integrated", "Android'in doğrusal ivmesi, integrali alınmış")}</text>`;
  s += hover(H, T, B, (i) => `${nf(tS[i], 0)} s · ${tt("pinned", "sabitli")} ${nf(v[i])} ${KMH()} · Android ${nf(vl[i])} ${KMH()}`);
  document.getElementById("c-speed").innerHTML = `<svg viewBox="0 0 ${CW} ${H}" role="img" aria-label="${tt("Speed over one run: the pinned estimate against Android's linear acceleration integrated", "Bir seferde hız: sabitlenmiş tahmin ve Android'in doğrusal ivmesinin integrali")}">${s}</svg>`;
})();

// 2. pressure: the dip below the platform-to-platform line, against dynamic pressure 1/2 rho v^2 (both Pa)
(function pressure() {
  const H = 250, T = 22, B = 30;
  const dip = col("p_res").map((x) => -x), q = col("q");
  const hi = Math.ceil(Math.max(...dip, ...q) / 100) * 100, lo = Math.min(0, Math.floor(Math.min(...dip) / 100) * 100);
  const { g, ys } = frame(H, T, B, lo, hi, 100, "Pa");
  let s = g + xAxis(H, B) + line(ys, q, "", "#1d4ed8") + line(ys, dip, "", "#c2410c");
  const iq = q.indexOf(Math.max(...q));
  s += `<text x="${xs(tS[iq]) + 8}" y="${ys(q[iq]) - 8}" class="lbl">½ρv²</text>`;
  const id = dip.indexOf(Math.max(...dip));
  s += `<text x="${xs(tS[id]) - 8}" y="${ys(dip[id]) + 22}" class="lbl" text-anchor="end">${tt("pressure dip in the car", "vagondaki basınç düşüşü")}</text>`;
  s += hover(H, T, B, (i) => `${nf(tS[i])} s · ${tt("dip", "düşüş")} ${nf(dip[i])} Pa · ½ρv² ${nf(q[i])} Pa`);
  document.getElementById("c-pressure").innerHTML = `<svg viewBox="0 0 ${CW} ${H}" role="img" aria-label="${tt("Pressure dip in the car against dynamic pressure over one run", "Bir seferde vagondaki basınç düşüşü ve dinamik basınç")}">${s}</svg>`;
})();

// 3. magnet: two panels, shared time axis - field (uT) on top, power per kg a*v (W/kg) below
(function magnet() {
  const B = col("B"), av = col("av"), a = col("a");
  const H1 = 190, H2 = 190;
  const m1 = Math.ceil(Math.max(...B.map(Math.abs)) / 50) * 50;
  const f1 = frame(H1, 22, 18, -m1, m1, 50, "µT");
  let s1 = f1.g + line(f1.ys, B, "", "#c2410c");
  s1 += `<text x="${CW - R}" y="${f1.ys(m1) + 14}" class="lbl" text-anchor="end">${tt("magnetometer: the motors' field", "manyetometre: motorların alanı")}</text>`;
  s1 += hover(H1, 22, 18, (i) => `${nf(tS[i])} s · ${nf(B[i])} µT`);
  const m2 = Math.ceil(Math.max(...av.map(Math.abs)) / 5) * 5;
  const f2 = frame(H2, 22, 30, -m2, m2, 5, "W/kg");
  let s2 = f2.g + xAxis(H2, 30) + line(f2.ys, av, "", "#1d4ed8");
  s2 += `<text x="${CW - R}" y="${f2.ys(m2) + 14}" class="lbl" text-anchor="end">${tt("power per kg, a·v (accelerometer)", "kg başına güç, a·v (ivmeölçer)")}</text>`;
  s2 += hover(H2, 22, 30, (i) => `${nf(tS[i])} s · a·v ${nf(av[i], 1)} W/kg · a ${nf(a[i], 2)} m/s² · v ${nf(col("v_kmh")[i])} ${KMH()}`);
  document.getElementById("c-magnet").innerHTML =
    `<svg viewBox="0 0 ${CW} ${H1}" role="img" aria-label="${tt("Magnetic field from the motors over one run", "Bir seferde motorlardan gelen manyetik alan")}">${s1}</svg>` +
    `<svg viewBox="0 0 ${CW} ${H2}" role="img" aria-label="${tt("Power per kilogram over the same run", "Aynı seferde kilogram başına güç")}">${s2}</svg>`;
})();

// 4. buses: spread of normalised gaps along the route (same unit for every series, one axis)
(function busSpread() {
  const H = 260, T = 22, B = 34, G = BUS.grid;
  const xg = (f) => L + f * (CW - L - R);
  const series = [
    [F1, "#c2410c", "", tt("frequent, dir. 1", "sık, 1. yön")], [F2, "#c2410c", "6 5", tt("frequent, dir. 2", "sık, 2. yön")],
    [I1, "#1d4ed8", "", tt("infrequent, dir. 1", "seyrek, 1. yön")], [BUS.lines.infrequent["2"], "#1d4ed8", "6 5", tt("infrequent, dir. 2", "seyrek, 2. yön")],
  ];
  const hi = Math.ceil(Math.max(...series.flatMap((s) => s[0].spread)) * 5) / 5;
  const ys = (v) => T + (1 - v / hi) * (H - T - B);
  let g = "";
  for (let v = 0; v <= hi + 1e-9; v += 0.2) g += `<line x1="${L}" x2="${CW - R}" y1="${ys(v)}" y2="${ys(v)}" class="${v ? "grid" : "base"}"/><text x="${L - 8}" y="${ys(v) + 4}" class="ax" text-anchor="end">${nf(v, 1)}</text>`;
  for (let f = 0; f <= 1.001; f += 0.25) g += `<text x="${xg(f)}" y="${H - B + 18}" class="ax" text-anchor="middle">${nf(f * 100)}%</text>`;
  g += `<text x="${CW - R}" y="${H - 4}" class="ax" text-anchor="end">${tt("position along the route", "güzergâhtaki konum")}</text>`;
  g += `<text x="${L - 8}" y="${T - 10}" class="ax" text-anchor="end">${tt("variance", "varyans")}</text>`;
  for (const [s, c, dash, name] of series) {
    g += `<polyline fill="none" stroke="${c}" stroke-width="2.2" stroke-dasharray="${dash}" stroke-linejoin="round" points="${s.spread.map((v, i) => `${xg(G[i]).toFixed(1)},${ys(v).toFixed(1)}`).join(" ")}"/>`;
    s.spread.forEach((v, i) => (g += `<circle cx="${xg(G[i])}" cy="${ys(v)}" r="9" fill="transparent"><title>${name} · ${nf(G[i] * 100)}% · ${nf(v, 2)}</title></circle>`));
  }
  const mid = Math.round(G.length * 0.3);
  g += `<text x="${xg(G[mid])}" y="${ys(Math.max(F1.spread[mid], F2.spread[mid])) - 14}" class="lbl" text-anchor="middle">${tt("frequent line", "sık hat")}</text>`;
  g += `<text x="${xg(G[mid])}" y="${ys(Math.min(I1.spread[mid], BUS.lines.infrequent["2"].spread[mid])) + 22}" class="lbl" text-anchor="middle">${tt("infrequent line", "seyrek hat")}</text>`;
  document.getElementById("c-spread").innerHTML = `<svg viewBox="0 0 ${CW} ${H}" role="img" aria-label="${tt("How uneven the gaps between buses get along the route, for both lines", "İki hatta otobüsler arasındaki araların güzergâh boyunca ne kadar düzensizleştiği")}">${g}</svg>`;
})();

// 5. buses: where the end-of-route spread comes from (shares add to 100%)
(function busShare() {
  const rows = [[F1, tt("frequent, direction 1", "sık hat, 1. yön")], [F2, tt("frequent, direction 2", "sık hat, 2. yön")]];
  const H = rows.length * 46 + 34, x0 = 170, x1 = CW - 20, wbar = x1 - x0;
  const parts = [["start", "#b08a1e", tt("at the start", "başta")], ["feedback", "#c2410c", tt("feedback", "geri besleme")], ["noise", "#1d4ed8", tt("random delays", "rastgele gecikmeler")]];
  let g = "";
  rows.forEach(([s, name], r) => {
    const y = 14 + r * 46;
    g += `<text x="${x0 - 12}" y="${y + 19}" class="ax" text-anchor="end">${name}</text>`;
    let x = x0;
    const tot = parts.reduce((a, [k]) => a + s.share[k], 0);
    for (const [k, c, label] of parts) {
      const w = (s.share[k] / tot) * wbar;
      if (w > 0.5) g += `<rect x="${x}" y="${y + 4}" width="${Math.max(0, w - 2)}" height="22" rx="4" fill="${c}"><title>${name} · ${label}: ${nf((100 * s.share[k]) / tot)}%</title></rect>`;
      if (w > 46) g += `<text x="${x + w / 2}" y="${y + 19}" class="val" text-anchor="middle" fill="#fff" style="fill:#fff">${nf((100 * s.share[k]) / tot)}%</text>`;
      x += w;
    }
  });
  document.getElementById("c-share").innerHTML = `<svg viewBox="0 0 ${CW} ${H}" role="img" aria-label="${tt("Share of the end-of-route spread already present at the start, grown by feedback, and added by random delays", "Güzergâh sonundaki saçılmanın baştan gelen, geri beslemenin büyüttüğü ve rastgele gecikmelerin eklediği payları")}">${g}</svg>`;
})();

document.documentElement.classList.add("wimr-ready");
