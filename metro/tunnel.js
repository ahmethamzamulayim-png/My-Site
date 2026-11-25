// Metro tunnel, rebuilt from phone sensors. Reads /metro/tube.json (see WhereisMyRide/analysis/tube.py).
// 3D view (three.js), a replay of the measured run, and the 2D charts + tables. Text via t() from /i18n.js.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const PHASE = {
  traction: { color: "#c2410c", en: "pulling", tr: "çekiş" },
  cruise: { color: "#b08a1e", en: "cruising / coasting", tr: "seyir / boşta" },
  braking: { color: "#1d4ed8", en: "slowing", tr: "yavaşlama" },
};
const SPEED_RAMP = ["#dbe4f7", "#9fb3e6", "#5f7fd3", "#2f4fb8", "#1b2f7a"]; // one hue, light -> dark
const UNIT = 100; // metres per scene unit
const KMH = (window.getLang && getLang() === "tr") ? "km/s" : "km/h";
const pc = (s) => (window.getLang && getLang() === "tr" ? "%" + s : s + "%");
const lang = () => (window.getLang ? getLang() : "en");
const tt = (en, tr) => (window.t ? t(en, tr) : en);
const nf = (v, d = 0) => Number(v).toLocaleString(lang() === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const res = await fetch("/metro/tube.json");
if (!res.ok) throw new Error("tube.json: HTTP " + res.status);
const D = await res.json();
const P = D.path.map((p) => ({ x: p[0], y: p[1], z: p[2], s: p[3], v: p[4], a: p[5], ph: p[6] }));
const ST = D.stations;
const SR = D.stretches;
const S_END = ST[ST.length - 1].s;

// ---------- helpers ----------
function at(s) {
  // linear interpolation of the path at distance s
  let lo = 0, hi = P.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
  const A = P[lo], B = P[hi], f = B.s > A.s ? (s - A.s) / (B.s - A.s) : 0;
  const L = (k) => A[k] + (B[k] - A[k]) * f;
  return { x: L("x"), y: L("y"), z: L("z"), s, v: L("v"), a: L("a"), ph: f < 0.5 ? A.ph : B.ph };
}
function stretchAt(s) {
  for (let i = 0; i < ST.length - 1; i++) if (s >= ST[i].s && s <= ST[i + 1].s) return SR[i];
  return SR[SR.length - 1];
}
function rampColor(v) {
  const f = Math.max(0, Math.min(1, v / 90)) * (SPEED_RAMP.length - 1);
  const i = Math.min(SPEED_RAMP.length - 2, Math.floor(f));
  return new THREE.Color(SPEED_RAMP[i]).lerp(new THREE.Color(SPEED_RAMP[i + 1]), f - i);
}

// ---------- 3D ----------
const host = document.getElementById("tube3d");
const hud = document.getElementById("hud");
const tip = document.getElementById("tubetip");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (e) {
  renderer = null;
}
let exag = 15, colorBy = "phase", playing = true;

if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9cfc2, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 80, 40);
  scene.add(sun);

  const cx = (ST[0].x + ST[ST.length - 1].x) / 2 / UNIT;
  const cz = -(Math.min(...P.map((p) => p.y)) + Math.max(...P.map((p) => p.y))) / 2 / UNIT;
  const toV = (p) => new THREE.Vector3(p.x / UNIT - cx, (p.z * exag) / UNIT, -p.y / UNIT - cz);

  const world = new THREE.Group();
  scene.add(world);
  let tube, rings = [], stationPos = [], floor;
  const sampled = P.filter((p, i) => i % 3 === 0 || i === P.length - 1);

  function build() {
    // free the previous geometry and materials: the slider rebuilds the whole tube on every step
    world.traverse((o) => {
      if (o === train) return;
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    world.clear();
    rings = []; stationPos = [];
    const pts = sampled.map(toV);
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    const segs = pts.length * 2, radial = 14;
    const geo = new THREE.TubeGeometry(curve, segs, 0.55, radial, false);
    // arc length in the scene -> distance along the track, for colouring and hover
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = cum[cum.length - 1];
    const sOfU = (u) => {
      const L = u * total;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < L) i++;
      const f = (L - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
      return sampled[i - 1].s + (sampled[i].s - sampled[i - 1].s) * f;
    };
    const cols = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i <= segs; i++) {
      const q = at(sOfU(i / segs));
      const c = colorBy === "phase" ? new THREE.Color(PHASE[q.ph].color) : rampColor(q.v);
      for (let j = 0; j <= radial; j++) c.toArray(cols, (i * (radial + 1) + j) * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    tube = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }));
    tube.userData.sOfU = sOfU;
    tube.userData.segs = segs;
    world.add(tube);
    // stations: a ring around the tube + a drop line to the floor
    const zmin = Math.min(...P.map((p) => p.z)) * exag / UNIT - 2.5;
    for (const s of ST) {
      const q = at(Math.min(s.s, S_END - 0.1));
      const p = toV(q);
      const ahead = toV(at(Math.min(s.s + 30, S_END))).sub(toV(at(Math.max(s.s - 30, 0))));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.12, 10, 36), new THREE.MeshStandardMaterial({ color: 0x2b2732 }));
      ring.position.copy(p);
      ring.lookAt(p.clone().add(ahead));
      world.add(ring);
      const drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, new THREE.Vector3(p.x, zmin, p.z)]),
        new THREE.LineDashedMaterial({ color: 0x8d8496, dashSize: 0.4, gapSize: 0.3 }));
      drop.computeLineDistances();
      world.add(drop);
      rings.push(ring);
      stationPos.push(p);
    }
    // floor grid for depth cues (not a map: no north, no scale bar)
    floor = new THREE.GridHelper(140, 28, 0xd8cfc4, 0xe9e2d8);
    floor.position.y = zmin;
    world.add(floor);
    world.add(train);
  }

  const train = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.8, 6, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x8a5a2b, emissiveIntensity: 0.3 }));
  build();
  // frame the whole line for the current aspect ratio: horizontal half-width / tan(horizontal half-fov)
  const halfW = (Math.max(...P.map((p) => p.x)) - Math.min(...P.map((p) => p.x))) / UNIT / 2 + 3;
  const VIEW_DIR = new THREE.Vector3(-0.12, 0.5, 0.86).normalize();
  let userMoved = false;
  controls.addEventListener("start", () => { userMoved = true; });
  function fitCamera() {
    if (userMoved) return;
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
    const dist = halfW / Math.tan(hfov / 2) * 1.5;
    camera.position.copy(VIEW_DIR.clone().multiplyScalar(dist));
    controls.target.set(0, 2, 0);
    camera.far = dist * 4;
    camera.updateProjectionMatrix();
  }

  // labels: HTML, projected each frame
  const labels = ST.map((s) => {
    const el = document.createElement("span");
    el.className = "stlabel";
    el.textContent = s.id;
    host.appendChild(el);
    return el;
  });

  // ---- replay of the measured run: time follows the real speed, dwells shortened
  const SPEEDUP = 8, DWELL = 1.6; // x real time; seconds of pause at each station
  let s = 0, dwellLeft = DWELL, last = performance.now();
  function advance(dt) {
    if (!playing) return;
    if (dwellLeft > 0) { dwellLeft -= dt; return; }
    const q = at(s);
    const v = Math.max(q.v / 3.6, 1.2); // m/s; never stall on the near-zero ends
    const next = s + v * dt * SPEEDUP;
    const st = ST.find((x) => x.s > s + 0.01 && x.s <= next);
    if (st) { s = st.s; dwellLeft = DWELL; if (st === ST[ST.length - 1]) { s = 0; } }
    else s = next;
  }

  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let hoverS = null;
  renderer.domElement.addEventListener("pointermove", (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObject(tube)[0];
    if (hit && hit.uv) {
      hoverS = tube.userData.sOfU(hit.uv.x);
      const q = at(hoverS), sr = stretchAt(hoverS);
      tip.hidden = false;
      tip.style.left = e.clientX - r.left + 14 + "px";
      tip.style.top = e.clientY - r.top + 14 + "px";
      tip.innerHTML = `<b>${sr.frm} → ${sr.to}</b> · ${nf(hoverS / 1000, 2)} km<br>` +
        `${nf(q.v)} ${KMH} · ${q.a >= 0 ? "+" : ""}${nf(q.a, 2)} m/s² · ${tt(PHASE[q.ph].en, PHASE[q.ph].tr)}<br>` +
        `${tt("height", "yükseklik")} ${nf(q.z, 1)} m ${tt("vs S1", "(S1'e göre)")} · ${tt("grade", "eğim")} ${pc(nf(sr.grade_pct, 1))}`;
    } else { tip.hidden = true; hoverS = null; }
  });
  renderer.domElement.addEventListener("pointerleave", () => { tip.hidden = true; });

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  let tekirFrame = "", tekirTick = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    advance(dt);
    const q = at(Math.min(s, S_END - 0.1));
    const p = toV(q), ahead = toV(at(Math.min(s + 25, S_END)));
    train.position.copy(p);
    if (ahead.distanceToSquared(p) > 1e-6) train.lookAt(ahead);
    train.rotateX(Math.PI / 2);
    controls.update();
    renderer.render(scene, camera);
    // station labels
    const w = host.clientWidth, h = host.clientHeight;
    stationPos.forEach((sp, i) => {
      const v = sp.clone().add(new THREE.Vector3(0, 1.6, 0)).project(camera);
      const el = labels[i];
      el.style.display = v.z < 1 ? "" : "none";
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    });
    // HUD: what the train is doing right now, and Tekir's mood to match
    const stopped = dwellLeft > 0;
    const sr = stretchAt(s);
    const want = stopped ? "sleep" : q.ph === "braking" ? "alert" : "walk";
    tekirTick += dt;
    const sprite = want === "sleep" ? (tekirTick % 1.2 < 0.6 ? "sleep1" : "sleep2")
      : want === "walk" ? (tekirTick % 0.5 < 0.25 ? "walk1" : "walk2") : "alert";
    if (sprite !== tekirFrame && window.Tekir) {
      document.getElementById("hudcat").innerHTML = Tekir.svg(sprite, 56);
      tekirFrame = sprite;
    }
    document.getElementById("hudtxt").innerHTML = stopped
      ? `<b>${(ST.find((x) => Math.abs(x.s - s) < 1) || ST[0]).id}</b> · ${tt("standing at the platform", "perona yanaşmış")}`
      : `<b>${nf(q.v)} ${KMH}</b> · <span class="ph ph-${q.ph}">${tt(PHASE[q.ph].en, PHASE[q.ph].tr)}</span><br>` +
        `${q.a >= 0 ? "+" : ""}${nf(q.a, 2)} m/s² · ${sr.frm} → ${sr.to} · ${tt("grade", "eğim")} ${pc(nf(sr.grade_pct, 1))}`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // controls
  document.getElementById("exag").addEventListener("input", (e) => {
    exag = +e.target.value;
    document.getElementById("exagval").textContent = "×" + exag;
    build();
  });
  document.querySelectorAll("[name=colorby]").forEach((r) => r.addEventListener("change", (e) => {
    colorBy = e.target.value;
    document.getElementById("legend-phase").hidden = colorBy !== "phase";
    document.getElementById("legend-speed").hidden = colorBy !== "speed";
    build();
  }));
  const pb = document.getElementById("playpause");
  pb.addEventListener("click", () => {
    playing = !playing;
    pb.textContent = playing ? tt("Pause", "Durdur") : tt("Play", "Oynat");
    pb.setAttribute("aria-pressed", String(!playing));
  });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) pb.click();
} else {
  host.classList.add("nogl");
  host.innerHTML = `<p>${tt("Your browser can't draw the 3D view (WebGL is off). The height and speed charts below show the same data.",
    "Tarayıcın 3B görünümü çizemiyor (WebGL kapalı). Aşağıdaki yükseklik ve hız grafikleri aynı veriyi gösteriyor.")}</p>`;
  hud.hidden = true;
}

// ---------- 2D charts (SVG) ----------
const W = 760, H = 230, L = 52, R = 16, T = 18, B = 34;
const xs = (s) => L + (s / S_END) * (W - L - R);
function axisX(h) {
  let g = "";
  for (let km = 0; km <= S_END / 1000; km += 2) g += `<text x="${xs(km * 1000)}" y="${h - 10}" class="ax" text-anchor="middle">${km} km</text>`;
  ST.forEach((s) => (g += `<line x1="${xs(s.s)}" x2="${xs(s.s)}" y1="${T}" y2="${h - B}" class="stl"/><text x="${xs(s.s)}" y="${T - 5}" class="stt" text-anchor="middle">${s.id}</text>`));
  return g;
}

// height profile: measured station heights (dots), interpolated between them (dashed); ground at the same stations
(function heightChart() {
  const zs = ST.flatMap((s) => [s.z_rail, s.z_ground]);
  const lo = Math.floor(Math.min(...zs) / 10) * 10 - 10, hi = Math.ceil(Math.max(...zs) / 10) * 10 + 10;
  const ys = (z) => T + (1 - (z - lo) / (hi - lo)) * (H - T - B);
  let g = "";
  for (let z = lo; z <= hi; z += 20) g += `<line x1="${L}" x2="${W - R}" y1="${ys(z)}" y2="${ys(z)}" class="grid"/><text x="${L - 8}" y="${ys(z) + 4}" class="ax" text-anchor="end">${z > 0 ? "+" : ""}${z} m</text>`;
  g += axisX(H);
  g += `<polyline class="ground" points="${ST.map((s) => `${xs(s.s)},${ys(s.z_ground)}`).join(" ")}"/>`;
  g += `<polyline class="rail" points="${ST.map((s) => `${xs(s.s)},${ys(s.z_rail)}`).join(" ")}"/>`;
  ST.forEach((s, i) => {
    const est = !!s.est;
    g += `<g><circle cx="${xs(s.s)}" cy="${ys(s.z_rail)}" r="5" class="${est ? "dot est" : "dot"}"/><circle cx="${xs(s.s)}" cy="${ys(s.z_rail)}" r="13" fill="transparent"/>` +
      `<title>${s.id}: ${tt("rail", "ray")} ${s.z_rail > 0 ? "+" : ""}${nf(s.z_rail, 1)} m${est ? tt(" (estimated)", " (tahmini)") : ""} · ${tt("ground", "zemin")} ${s.z_ground > 0 ? "+" : ""}${nf(s.z_ground)} m</title></g>`;
  });
  document.getElementById("hchart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${tt("Rail height and ground height at each station, relative to S1", "Her istasyonda ray ve zemin yüksekliği, S1'e göre")}">${g}</svg>`;
})();

// speed along the track, coloured by phase (identity also given by the labels in the legend)
(function speedChart() {
  const ys = (v) => T + (1 - v / 100) * (H - T - B);
  let g = "";
  for (let v = 0; v <= 75; v += 25) g += `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" class="${v ? "grid" : "base"}"/><text x="${L - 8}" y="${ys(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
  g += `<line x1="${L}" x2="${W - R}" y1="${ys(100)}" y2="${ys(100)}" class="grid"/>`;
  g += axisX(H);
  let seg = [], cur = null;
  const flush = () => { if (seg.length > 1) g += `<polyline fill="none" stroke="${PHASE[cur].color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" points="${seg.join(" ")}"/>`; };
  P.forEach((p) => {
    const pt = `${xs(p.s).toFixed(1)},${ys(p.v).toFixed(1)}`;
    if (p.ph !== cur) { if (seg.length) { seg.push(pt); flush(); } seg = [pt]; cur = p.ph; } else seg.push(pt);
  });
  flush();
  // hover: one band per 100 m
  for (let s0 = 0; s0 < S_END; s0 += 100) {
    const q = at(s0 + 50);
    g += `<rect x="${xs(s0)}" y="${T}" width="${xs(s0 + 100) - xs(s0)}" height="${H - T - B}" fill="transparent"><title>${nf((s0 + 50) / 1000, 2)} km · ${nf(q.v)} ${KMH} · ${tt(PHASE[q.ph].en, PHASE[q.ph].tr)}</title></rect>`;
  }
  g += `<text x="${L - 8}" y="${T + 4}" class="ax" text-anchor="end">${KMH}</text>`;
  document.getElementById("vchart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${tt("Measured speed along the tunnel, coloured by what the train was doing", "Tünel boyunca ölçülen hız, trenin ne yaptığına göre renkli")}">${g}</svg>`;
})();

// braking energy per stretch: motion energy at the start of slowing + height lost (or gained) while slowing
(function energyChart() {
  const rows = SR.map((r) => ({ id: `${r.frm}→${r.to}`, ke: r.brake_ke_jkg, pe: r.brake_pe_jkg, grade: r.grade_pct, from: r.brake_from_kmh }));
  const max = Math.max(...rows.map((r) => r.ke + Math.max(0, r.pe)));
  const min = Math.min(0, ...rows.map((r) => r.pe));
  const w = 760, rowH = 30, h = rows.length * rowH + 40, x0 = 110, x1 = w - 90;
  const xv = (v) => x0 + ((v - min) / (max - min)) * (x1 - x0);
  let g = `<line x1="${xv(0)}" x2="${xv(0)}" y1="10" y2="${h - 26}" class="base"/>`;
  rows.forEach((r, i) => {
    const y = 14 + i * rowH;
    g += `<text x="${x0 - 10}" y="${y + 15}" class="ax" text-anchor="end">${r.id}</text>`;
    g += `<rect x="${xv(0)}" y="${y + 3}" width="${Math.max(0, xv(r.ke) - xv(0))}" height="16" rx="3" fill="#1d4ed8"/>`;
    if (r.pe > 0) g += `<rect x="${xv(r.ke) + 2}" y="${y + 3}" width="${Math.max(0, xv(r.ke + r.pe) - xv(r.ke) - 2)}" height="16" rx="3" fill="#c2410c"/>`;
    if (r.pe < 0) g += `<rect x="${xv(r.pe)}" y="${y + 3}" width="${xv(0) - xv(r.pe) - 2}" height="16" rx="3" fill="#b08a1e"/>`;
    const net = r.ke + r.pe;
    g += `<text x="${xv(Math.max(r.ke, r.ke + r.pe)) + 8}" y="${y + 15}" class="val">${nf(net)}</text>`;
    g += `<rect x="0" y="${y}" width="${w}" height="${rowH - 2}" fill="transparent"><title>${r.id}: ${tt("slowing from", "yavaşlama başlangıcı")} ${nf(r.from)} ${KMH} · ${tt("motion", "hareket")} ${nf(r.ke)} J/kg · ${tt("height", "yükseklik")} ${r.pe >= 0 ? "+" : ""}${nf(r.pe)} J/kg · ${tt("brakes", "frenler")} ≈ ${nf(net)} J/kg</title></rect>`;
  });
  g += `<text x="${x1 + 70}" y="${h - 8}" class="ax" text-anchor="end">J/kg = kJ ${tt("per tonne", "/ ton")}</text>`;
  document.getElementById("echart").innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${tt("Energy the brakes absorb on each stretch, split into motion and height", "Her aralıkta frenlerin emdiği enerji, hareket ve yükseklik olarak")}">${g}</svg>`;
})();

// tables
(function tables() {
  const q = (s) => s === "good" ? tt("good", "iyi") : tt("rough", "kaba");
  document.getElementById("vtab").innerHTML = SR.map((r) => `<tr><td>${r.frm} → ${r.to}</td><td>${nf(r.gyro_turn_deg, 1)}°</td><td>${nf(r.osm_turn_deg, 1)}°</td><td>${nf(r.max_offset_m)} m</td><td>${r.dz_m > 0 ? "+" : ""}${nf(r.dz_m, 1)} m${ST.find((s) => s.id === r.to).est ? ` <span class="muted">${tt("est.", "tah.")}</span>` : ""}</td><td>${q(r.quality)}</td></tr>`).join("");
  document.getElementById("mtab").innerHTML = SR.map((r) => `<tr><td>${r.frm} → ${r.to}</td><td>${nf(r.length_m)} m</td><td>${pc((r.grade_pct > 0 ? "+" : "") + nf(r.grade_pct, 1))}</td><td>${nf(r.peak_kmh)}</td><td>${nf(r.traction_peak, 2)}</td><td>${nf(r.braking_peak, 2)}</td><td>${nf(r.jerk_start, 1)} / ${nf(r.jerk_stop, 1)}</td><td>${nf(r.vib_aw, 2)}</td></tr>`).join("");
})();
