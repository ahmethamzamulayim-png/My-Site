/* WhereisMyRide recorder.
 *
 * Pick line + boarding + alighting station, press start, ride, press stop.
 * The ride is kept on the phone (IndexedDB) and shared as a .zip holding
 *   Raw Data.csv  - phyphox's "Acceleration (without g)" CSV layout
 *   ride.yaml     - line, stations, direction, exact start time, phone position
 * which is exactly what analysis/ride.py reads, so a shared ride goes straight
 * into the analysis with no hand-editing.
 */
(() => {
  "use strict";
  const VERSION = "0.1.0";
  // Turkish unless the phone is set to another language; data-t holds "Türkçe|English"
  const EN = !(navigator.language || "tr").toLowerCase().startsWith("tr");
  const T = (pair) => pair.split("|")[EN ? 1 : 0] ?? pair;
  const tr = (trText, enText) => (EN ? enText : trText);
  document.documentElement.lang = EN ? "en" : "tr";
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = T(el.dataset.t)));
  document.querySelectorAll("[data-ph]").forEach((el) => (el.placeholder = T(el.dataset.ph)));

  const $ = (id) => document.getElementById(id);
  let LINES = [];
  const sel = { line: null, board: null, alight: null };

  // ---------- setup screen ----------
  fetch("lines.json")
    .then((r) => r.json())
    .then((j) => {
      LINES = j.lines;
      const box = $("lines");
      for (const l of LINES) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = l.line;
        b.setAttribute("aria-pressed", "false");
        b.onclick = () => pickLine(l.line);
        box.appendChild(b);
      }
      const last = load("last", null);
      pickLine(last && LINES.some((l) => l.line === last.line) ? last.line : "M4", last);
    });

  function lineObj() { return LINES.find((l) => l.line === sel.line); }

  function fillSelect(el, stations, value) {
    el.innerHTML = "";
    for (const s of stations) {
      const o = document.createElement("option");
      o.value = s.name;
      o.textContent = s.name;
      el.appendChild(o);
    }
    if (value && stations.some((s) => s.name === value)) el.value = value;
  }

  function pickLine(code, last) {
    sel.line = code;
    document.querySelectorAll("#lines button").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === code)));
    const st = lineObj().stations;
    fillSelect($("board"), st, last && last.board);
    fillSelect($("alight"), st, last ? last.alight : st[st.length - 1].name);
    if (last && last.pos) $("pos").value = last.pos;
    updateDir();
  }

  function updateDir() {
    sel.board = $("board").value;
    sel.alight = $("alight").value;
    const st = lineObj().stations.map((s) => s.name);
    const i = st.indexOf(sel.board), j = st.indexOf(sel.alight);
    const ok = i >= 0 && j >= 0 && i !== j;
    sel.direction = ok ? (j > i ? st[st.length - 1] : st[0]) : null;
    sel.nstops = ok ? Math.abs(j - i) : null;
    $("dir").textContent = ok
      ? tr(`${sel.direction} yönü · ${sel.nstops} durak`, `towards ${sel.direction} · ${sel.nstops} stops`)
      : tr("Farklı iki istasyon seç.", "Pick two different stations.");
    $("start").disabled = !ok || !sensorOK;
  }
  $("board").onchange = updateDir;
  $("alight").onchange = updateDir;

  const sensorOK = "DeviceMotionEvent" in window;
  if (!sensorOK) {
    $("nosensor").textContent = tr("Bu tarayıcı hareket sensörünü vermiyor.", "This browser doesn't expose the motion sensor.");
    $("nosensor").classList.remove("hidden");
  }

  // ---------- recording ----------
  let rec = null; // { t:[], x:[], y:[], z:[], wall0, t0, sensor, gaps:[], ... }
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
    save("last", { line: sel.line, board: sel.board, alight: sel.alight, pos: $("pos").value });
    rec = { t: [], x: [], y: [], z: [], gx: [], gy: [], gz: [], wall0: null, t0: null, sensor: null, gaps: [], lastT: null,
            line: sel.line, board: sel.board, alight: sel.alight, direction: sel.direction,
            nstops: sel.nstops, pos: $("pos").value, live: { moving: false, since: 0, stops: 0, runs: 0 } };
    $("route").textContent = `${sel.line} · ${sel.board} → ${sel.alight}`;
    $("expect").textContent = sel.nstops;
    $("nstops").textContent = "0";
    $("notes").value = "";
    $("vehicle").value = "";
    $("gapwarn").classList.add("hidden");
    $("setup").classList.add("hidden");
    $("recording").classList.remove("hidden");
    await keepAwake();
    window.addEventListener("devicemotion", onMotion);
    tick = setInterval(render, 500);
  };

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
    const moving = s.shake > 0.06; // rough; a train shakes a phone far more than a platform does
    if (moving !== L.moving && s.t - L.since > (moving ? 4 : 8)) {
      if (!moving && s.t - L.since > 15) { L.stops++; $("nstops").textContent = L.stops; }
      L.moving = moving;
      L.since = s.t;
    }
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
    $("setup").classList.remove("hidden");
    if (!r.t.length) { alert(tr("Hiç sensör verisi gelmedi.", "No sensor data arrived.")); return; }
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
      li.textContent = tr("Henüz kayıt yok.", "No rides yet.");
      ul.appendChild(li);
      return;
    }
    for (const r of rides) {
      const li = document.createElement("li");
      const info = document.createElement("div");
      const title = document.createElement("div");
      title.textContent = `${r.meta.line} · ${r.meta.board} → ${r.meta.alight}`;
      const small = document.createElement("small");
      small.textContent = `${r.meta.date} ${r.meta.start_clock.slice(0, 5)} · ${Math.round(r.meta.duration_s / 60)} ${tr("dk", "min")}` +
        (r.meta.sensor_gaps.length ? ` · ⚠ ${r.meta.sensor_gaps.length} ${tr("boşluk", "gaps")}` : "");
      info.append(title, small);
      const btns = document.createElement("div");
      btns.className = "row";
      const sh = document.createElement("button");
      sh.className = "ghost";
      sh.textContent = tr("Paylaş", "Share");
      sh.onclick = () => share([r]);
      const del = document.createElement("button");
      del.className = "ghost";
      del.textContent = "✕";
      del.setAttribute("aria-label", tr("Sil", "Delete"));
      del.onclick = async () => { if (confirm(tr("Bu kayıt silinsin mi?", "Delete this ride?"))) { await dbDel(r.id); listRides(); } };
      btns.append(sh, del);
      li.append(info, btns);
      ul.appendChild(li);
    }
  }

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
