/* WhereisMyRide recorder.
 *
 * Tap a line tile → its stations slide up as a metro strip → tap where you are
 * → tap where you're going → pick where the phone is → start. Ride. Stop.
 * The ride is kept on the phone (IndexedDB) and shared as a .zip holding
 *   Raw Data.csv  - phyphox's "Acceleration (without g)" CSV layout (+ gravity)
 *   ride.yaml     - line, stations, direction, exact start time, phone position
 * which analysis/ride.py reads directly.
 */
(() => {
  "use strict";
  const VERSION = "0.2.0";
  // Turkish unless the phone is set to another language; data-t holds "Türkçe|English"
  const EN = !(navigator.language || "tr").toLowerCase().startsWith("tr");
  const T = (pair) => pair.split("|")[EN ? 1 : 0] ?? pair;
  const tr = (trText, enText) => (EN ? enText : trText);
  document.documentElement.lang = EN ? "en" : "tr";
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = T(el.dataset.t)));
  document.querySelectorAll("[data-ph]").forEach((el) => (el.placeholder = T(el.dataset.ph)));
  const $ = (id) => document.getElementById(id);

  // Line colours as on Metro İstanbul's network map (values as used by mdemirer/sonraki-tren).
  const COLORS = {
    M1A: "#EE2229", M1B: "#EE2229", M2: "#059A4D", M3: "#0CA6DF", M4: "#E81E77", M5: "#683166",
    M6: "#C9AA79", M7: "#F490B3", M8: "#487ABF", M9: "#FCD10D", M11: "#A1609B", M12: "#7DBB42", M14: "#9C7E4F",
    T1: "#004B86", T2: "#90ABA0", T3: "#99562F", T4: "#FF7E42", T5: "#7B72B2",
    F1: "#7A745A", F2: "#7A745A", F3: "#7A745A", F4: "#7A745A", TF1: "#5C7A8A", TF2: "#5C7A8A",
  };
  const GROUPS = [
    { key: "M", title: "Metro|Metro", test: (c) => /^M/.test(c) },
    { key: "T", title: "Tramvay|Tram", test: (c) => /^T\d/.test(c) },
    { key: "F", title: "Füniküler & teleferik|Funicular & cable car", test: (c) => /^(F|TF)/.test(c) },
  ];
  const POSITIONS = [
    ["bag-on-floor", "Çanta yerde, ayaklarımın arasında|Bag on the floor between my feet"],
    ["pocket", "Ön cepte|Front pocket"],
    ["bag-on-body", "Taktığım çantada|In a bag I'm wearing"],
    ["hand", "Elimde|In my hand"],
    ["seat-flat", "Boş koltukta, düz|Flat on an empty seat"],
    ["lap-flat", "Kucakta, düz|Flat on my lap"],
  ];

  // ---------- colour helpers ----------
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const darker = (h, k = 0.72) => hex(rgb(h).map((v) => v * k));
  const lum = (h) => {
    const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const inkOn = (h) => (lum(h) > 0.42 ? "#16181D" : "#FFFFFF"); // yellow M9, beige M6, pink M7 get dark text
  const colorOf = (code) => COLORS[code] || "#5B6878";
  function paint(el, code, prefix = "--c") {
    const c = colorOf(code);
    el.style.setProperty(prefix, c);
    el.style.setProperty(prefix + "-dark", darker(c));
    el.style.setProperty(prefix + "-ink", inkOn(c));
  }
  function badge(el, code) {
    el.textContent = code;
    el.style.setProperty("--b", colorOf(code));
    el.style.setProperty("--b-ink", inkOn(colorOf(code)));
  }

  // ---------- state ----------
  let LINES = [];
  const sel = { line: null, from: null, to: null, pos: load("pos", "bag-on-floor") };
  const lineObj = () => LINES.find((l) => l.line === sel.line);
  const names = () => lineObj().stations.map((s) => s.name);

  // ---------- home ----------
  fetch("lines.json").then((r) => r.json()).then((j) => {
    LINES = j.lines;
    const box = $("groups");
    for (const g of GROUPS) {
      const lines = LINES.filter((l) => g.test(l.line));
      if (!lines.length) continue;
      const h = document.createElement("h2");
      h.textContent = T(g.title);
      const grid = document.createElement("div");
      grid.className = "tiles";
      for (const l of lines) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tile";
        b.dataset.line = l.line;
        const c = colorOf(l.line);
        b.style.setProperty("--t", c);
        b.style.setProperty("--t-dark", darker(c));
        b.style.setProperty("--t-ink", inkOn(c));
        const st = l.stations;
        b.innerHTML = `<span class="code"></span><span class="ends"></span>`;
        b.querySelector(".code").textContent = l.line;
        b.querySelector(".ends").textContent = `${st[0].name} – ${st[st.length - 1].name}`;
        b.setAttribute("aria-label", `${l.line}: ${st[0].name} – ${st[st.length - 1].name}`);
        b.onclick = () => openLine(l.line);
        grid.appendChild(b);
      }
      box.append(h, grid);
    }
    showAgain();
  });

  function showAgain() {
    const last = load("last", null);
    if (!last || !LINES.some((l) => l.line === last.line)) return;
    badge($("againBadge"), last.line);
    $("againRoute").textContent = `${last.from} → ${last.to}`;
    $("again").classList.remove("hidden");
    $("again").onclick = () => {
      openLine(last.line);
      pickStation(last.from);
      pickStation(last.to);
    };
  }

  // ---------- sheet: stations ----------
  function openLine(code) {
    sel.line = code;
    sel.from = sel.to = null;
    paint(document.documentElement, code);
    const st = lineObj().stations;
    badge($("sheetBadge"), code);
    $("sheetTitle").textContent = code;
    $("sheetEnds").textContent = `${st[0].name} – ${st[st.length - 1].name}`;
    $("filter").value = "";
    $("filter").placeholder = tr("İstasyon ara", "Search stations");
    $("filter").classList.toggle("hidden", st.length < 9);
    $("sheet").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    step(1);
  }

  function closeSheet() {
    $("sheet").classList.add("hidden");
    document.body.style.overflow = "";
  }
  $("sheetClose").onclick = closeSheet;
  $("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").classList.contains("hidden")) closeSheet(); });
  $("filter").addEventListener("input", () => drawStrip());

  function step(n) {
    document.querySelectorAll(".steps i").forEach((i) => i.classList.toggle("on", Number(i.dataset.step) <= n));
    $("pickStations").classList.toggle("hidden", n === 3);
    $("confirm").classList.toggle("hidden", n !== 3);
    $("prompt").textContent = n === 1 ? tr("Neredesin?", "Where are you?")
      : n === 2 ? tr("Nereye gidiyorsun?", "Where are you going?") : tr("Hazır mısın?", "Ready?");
    if (n < 3) drawStrip();
    else drawConfirm();
  }

  function drawStrip() {
    const ol = $("strip");
    ol.innerHTML = "";
    const all = names();
    const q = norm($("filter").value);
    const i = sel.from ? all.indexOf(sel.from) : -1;
    all.forEach((name, k) => {
      if (q && !norm(name).includes(q)) return;
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="rail"><span class="node"></span></span><span class="sname"></span>`;
      b.querySelector(".sname").textContent = name;
      if (name === sel.from) {
        li.classList.add("from");
        b.disabled = true;
        b.append(pill(tr("Buradasın", "You're here")));
      }
      b.onclick = () => pickStation(name);
      li.appendChild(b);
      ol.appendChild(li);
      void k;
    });
    if (i >= 0 && !q) ol.children[i].scrollIntoView({ block: "center" });
  }

  function pickStation(name) {
    if (!sel.from) {
      sel.from = name;
      step(2);
      return;
    }
    if (name === sel.from) return;
    sel.to = name;
    step(3);
  }

  function drawConfirm() {
    const all = names();
    const i = all.indexOf(sel.from), j = all.indexOf(sel.to);
    sel.direction = j > i ? all[all.length - 1] : all[0];
    sel.nstops = Math.abs(j - i);
    $("cFrom").textContent = sel.from;
    $("cTo").textContent = sel.to;
    $("cDir").textContent = tr(`${sel.direction} yönü · ${sel.nstops} durak`, `towards ${sel.direction} · ${sel.nstops} stops`);
    const box = $("pos");
    box.innerHTML = "";
    for (const [value, label] of POSITIONS) {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "chip";
      c.setAttribute("role", "radio");
      c.setAttribute("aria-checked", String(sel.pos === value));
      c.textContent = T(label);
      c.onclick = () => { sel.pos = value; save("pos", value); drawConfirm(); };
      box.appendChild(c);
    }
    $("start").disabled = !sensorOK;
  }
  $("backToStations").onclick = () => { sel.from = sel.to = null; step(1); };

  const sensorOK = "DeviceMotionEvent" in window;
  if (!sensorOK) {
    $("nosensor").textContent = tr("Bu tarayıcı hareket sensörünü vermiyor.", "This browser doesn't expose the motion sensor.");
    $("nosensor").classList.remove("hidden");
  }

  // ---------- recording ----------
  let rec = null;
  let wakeLock = null;
  let tick = null;

  async function keepAwake() {
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; }
  }
  document.addEventListener("visibilitychange", () => {
    if (rec && document.visibilityState === "visible") keepAwake();
  });

  $("start").onclick = async () => {
    // iOS needs an explicit permission prompt; Android Chrome grants it silently
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      try {
        if ((await DeviceMotionEvent.requestPermission()) !== "granted") return;
      } catch { return; }
    }
    save("last", { line: sel.line, from: sel.from, to: sel.to });
    const all = names();
    const i = all.indexOf(sel.from), j = all.indexOf(sel.to);
    rec = { t: [], x: [], y: [], z: [], gx: [], gy: [], gz: [], wall0: null, t0: null, sensor: null, gaps: [], lastT: null,
            line: sel.line, board: sel.from, alight: sel.to, direction: sel.direction,
            nstops: sel.nstops, pos: sel.pos, trip: i < j ? all.slice(i, j + 1) : all.slice(j, i + 1).reverse(),
            live: { moving: false, since: 0, stops: 0 } };
    closeSheet();
    badge($("recBadge"), sel.line);
    $("recBadge").style.setProperty("--b", inkOn(colorOf(sel.line)));  // inverted on the coloured band
    $("recBadge").style.setProperty("--b-ink", colorOf(sel.line));
    $("recRoute").textContent = `${sel.from} → ${sel.to}`;
    $("recDir").textContent = tr(`${sel.direction} yönü`, `towards ${sel.direction}`);
    $("expect").textContent = sel.nstops;
    $("nstops").textContent = "0";
    $("notes").value = "";
    $("vehicle").value = "";
    $("gapwarn").classList.add("hidden");
    $("home").classList.add("hidden");
    $("recording").classList.remove("hidden");
    drawRecStrip();
    window.scrollTo(0, 0);
    await keepAwake();
    window.addEventListener("devicemotion", onMotion);
    tick = setInterval(render, 500);
  };

  function drawRecStrip() {
    const ol = $("recStrip");
    ol.innerHTML = "";
    const at = Math.min(rec.live.stops, rec.trip.length - 1);
    rec.trip.forEach((name, k) => {
      const li = document.createElement("li");
      li.className = "inride" + (k === 0 ? " first" : "") + (k === rec.trip.length - 1 ? " last" : "");
      if (k < at) li.classList.add("passed");
      if (k === at) li.classList.add("train");
      if (k === rec.trip.length - 1) li.classList.add("to");
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span class="rail"><span class="node"></span></span><span class="sname"></span>`;
      row.querySelector(".sname").textContent = name;
      if (k === at) row.append(pill(rec.live.moving ? tr("Yolda", "Moving") : tr("Burada", "Here")));
      li.appendChild(row);
      ol.appendChild(li);
    });
  }

  function onMotion(e) {
    let a = e.acceleration, sensor = "linear";
    if (!a || a.x == null) { a = e.accelerationIncludingGravity; sensor = "with-gravity"; }
    if (!a || a.x == null) return;
    const now = e.timeStamp / 1000;
    if (rec.t0 === null) {
      rec.t0 = now;
      rec.wall0 = new Date(Date.now() - (performance.now() - e.timeStamp)); // wall clock of the first sample
      rec.sensor = sensor;
    }
    const t = now - rec.t0;
    if (rec.lastT !== null && t - rec.lastT > 1.0) rec.gaps.push([round(rec.lastT, 2), round(t, 2)]);
    rec.lastT = t;
    rec.t.push(t); rec.x.push(a.x); rec.y.push(a.y); rec.z.push(a.z);
    // gravity direction: tells the analysis which way is down, so it can split
    // vertical from sideways shaking (ride comfort). Only when both readings exist.
    const g = e.accelerationIncludingGravity;
    if (sensor === "linear" && g && g.x != null) {
      rec.gx.push(g.x - a.x); rec.gy.push(g.y - a.y); rec.gz.push(g.z - a.z);
    }
  }

  // Live stopped/moving guess, for the screen only - the real analysis is offline.
  function liveState() {
    const n = rec.t.length;
    if (n < 30) return null;
    const tEnd = rec.t[n - 1];
    let i = n - 1;
    while (i > 0 && tEnd - rec.t[i] < 3) i--;
    const sd = (arr) => {
      let m = 0, k = 0;
      for (let j = i; j < n; j++) { m += arr[j]; k++; }
      m /= k;
      let v = 0;
      for (let j = i; j < n; j++) v += (arr[j] - m) ** 2;
      return v / k;
    };
    return { shake: Math.sqrt(sd(rec.x) + sd(rec.y) + sd(rec.z)), t: tEnd, hz: (n - i) / Math.max(tEnd - rec.t[i], 0.1) };
  }

  function render() {
    const el = rec.lastT || 0;
    $("elapsed").textContent = `${Math.floor(el / 60)}:${String(Math.floor(el % 60)).padStart(2, "0")}`;
    const s = liveState();
    if (!s) { $("statetext").textContent = tr("Sensör bekleniyor…", "Waiting for sensor…"); return; }
    $("hz").textContent = Math.round(s.hz);
    const L = rec.live;
    const before = `${L.stops}${L.moving}`;
    const moving = s.shake > 0.06; // rough; a train shakes a phone far more than a platform does
    if (moving !== L.moving && s.t - L.since > (moving ? 4 : 8)) {
      if (!moving && s.t - L.since > 15) { L.stops++; $("nstops").textContent = L.stops; }
      L.moving = moving;
      L.since = s.t;
    }
    if (`${L.stops}${L.moving}` !== before) drawRecStrip();
    $("state").classList.toggle("moving", L.moving);
    $("statetext").textContent = L.moving ? tr("Hareket halinde", "Moving") : tr("Duruyor", "Stopped");
    if (rec.gaps.length) {
      $("gapwarn").textContent = tr(`Sensör ${rec.gaps.length} kez durdu (ekran kapandı mı?)`, `Sensor paused ${rec.gaps.length}× (did the screen turn off?)`);
      $("gapwarn").classList.remove("hidden");
    }
  }

  $("stop").onclick = async () => {
    window.removeEventListener("devicemotion", onMotion);
    clearInterval(tick);
    try { await wakeLock?.release(); } catch { /* already released */ }
    const r = rec;
    rec = null;
    $("recording").classList.add("hidden");
    $("home").classList.remove("hidden");
    showAgain();
    if (!r.t.length) { toast(tr("Hiç sensör verisi gelmedi.", "No sensor data arrived.")); return; }
    const ride = {
      id: `${ymd(r.wall0)}_${hm(r.wall0)}_${r.line}_${slug(r.board)}-${slug(r.alight)}`,
      meta: {
        date: ymd(r.wall0), line: r.line, direction: r.direction, board: r.board, alight: r.alight,
        phone_position: r.pos, start_clock: hms(r.wall0), notes: $("notes").value.trim(),
        vehicle: $("vehicle").value.trim(),
        sensor: r.sensor, samples: r.t.length, duration_s: round(r.t[r.t.length - 1], 1),
        sample_rate_hz: round(r.t.length / Math.max(r.t[r.t.length - 1], 1), 1),
        sensor_gaps: r.gaps, live_stops_counted: r.live.stops, stations_expected: r.nstops,
        app: `WhereisMyRide web ${VERSION}`, user_agent: navigator.userAgent,
      },
      csv: toCSV(r),
    };
    await dbPut(ride);
    listRides();
    toast(tr("Kaydedildi ✓", "Saved ✓"));
  };

  // ---------- export ----------
  function toCSV(r) {
    const head = r.sensor === "linear"
      ? '"Time (s)","Linear Acceleration x (m/s^2)","Linear Acceleration y (m/s^2)","Linear Acceleration z (m/s^2)"'
      : '"Time (s)","Acceleration x (m/s^2)","Acceleration y (m/s^2)","Acceleration z (m/s^2)"';
    const out = [head];
    const grav = r.gx.length === r.t.length; // gravity columns only if every sample has them
    if (grav) out[0] += ',"Gravity x (m/s^2)","Gravity y (m/s^2)","Gravity z (m/s^2)"';
    for (let i = 0; i < r.t.length; i++) {
      let row = `${r.t[i].toFixed(4)},${r.x[i].toFixed(5)},${r.y[i].toFixed(5)},${r.z[i].toFixed(5)}`;
      if (grav) row += `,${r.gx[i].toFixed(3)},${r.gy[i].toFixed(3)},${r.gz[i].toFixed(3)}`;
      out.push(row);
    }
    return out.join("\n") + "\n";
  }

  function toYAML(meta) {
    const q = (v) => (typeof v === "number" ? String(v) : JSON.stringify(v)); // JSON strings are valid YAML
    return Object.entries(meta).map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : q(v)}`).join("\n") + "\n";
  }

  function rideZip(ride) {
    return makeZip([
      { name: "Raw Data.csv", data: ride.csv },
      { name: "ride.yaml", data: toYAML(ride.meta) },
    ]);
  }

  async function share(rides) {
    const files = rides.map((r) => new File([rideZip(r)], `${r.id}.zip`, { type: "application/zip" }));
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files, title: "WhereisMyRide" }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    for (const f of files) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  }

  async function listRides() {
    const rides = (await dbAll()).sort((a, b) => b.id.localeCompare(a.id));
    const ul = $("rides");
    ul.innerHTML = "";
    $("shareall").classList.toggle("hidden", rides.length < 2);
    $("shareall").onclick = () => share(rides);
    if (!rides.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = tr("Henüz yolculuk yok. Bir hat seç ve başla.", "No rides yet. Pick a line to start.");
      ul.appendChild(li);
      return;
    }
    for (const r of rides) {
      const li = document.createElement("li");
      li.className = "ride";
      const b = document.createElement("span");
      b.className = "badge";
      badge(b, r.meta.line);
      const info = document.createElement("div");
      info.className = "info";
      const title = document.createElement("b");
      title.textContent = `${r.meta.board} → ${r.meta.alight}`;
      const small = document.createElement("small");
      small.textContent = `${r.meta.date} ${r.meta.start_clock.slice(0, 5)} · ${Math.round(r.meta.duration_s / 60)} ${tr("dk", "min")}` +
        (r.meta.sensor_gaps.length ? ` · ⚠ ${r.meta.sensor_gaps.length} ${tr("boşluk", "gaps")}` : "");
      info.append(title, small);
      const sh = document.createElement("button");
      sh.className = "icon-btn";
      sh.type = "button";
      sh.textContent = tr("Paylaş", "Share");
      sh.onclick = () => share([r]);
      const del = document.createElement("button");
      del.className = "icon-btn";
      del.type = "button";
      del.textContent = "✕";
      del.setAttribute("aria-label", tr("Sil", "Delete"));
      del.onclick = async () => { if (confirm(tr("Bu kayıt silinsin mi?", "Delete this ride?"))) { await dbDel(r.id); listRides(); } };
      li.append(b, info, sh, del);
      ul.appendChild(li);
    }
  }

  // ---------- small UI helpers ----------
  function pill(text) {
    const p = document.createElement("span");
    p.className = "pill";
    p.textContent = text;
    return p;
  }
  let toastTimer;
  function toast(text) {
    $("toast").textContent = text;
    $("toast").classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 2200);
  }
  const norm = (s) => s.toLocaleLowerCase("tr").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").trim();

  // ---------- helpers ----------
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const hms = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const round = (v, k) => Math.round(v * 10 ** k) / 10 ** k;
  const slug = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^A-Za-z0-9]+/g, "").slice(0, 16);
  function load(k, d) { try { return JSON.parse(localStorage.getItem("wimr." + k)) ?? d; } catch { return d; } }
  function save(k, v) { try { localStorage.setItem("wimr." + k, JSON.stringify(v)); } catch { /* storage off */ } }

  // IndexedDB: rides can be several MB each, too big for localStorage
  const dbp = new Promise((res, rej) => {
    const q = indexedDB.open("wimr", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("rides", { keyPath: "id" });
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  const tx = async (mode, fn) => {
    const db = await dbp;
    return new Promise((res, rej) => {
      const t = db.transaction("rides", mode);
      const r = fn(t.objectStore("rides"));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  };
  const dbPut = (ride) => tx("readwrite", (s) => s.put(ride));
  const dbDel = (id) => tx("readwrite", (s) => s.delete(id));
  const dbAll = () => tx("readonly", (s) => s.getAll());

  // Minimal ZIP writer (stored, no compression) - enough for two text files, no library needed
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function makeZip(entries) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), data = enc.encode(e.data), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  listRides();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
