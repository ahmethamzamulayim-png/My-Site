/* Browser test for the recorder app: open it, pick M4 Göztepe -> Kadıköy, press
 * start, feed a synthetic ride into the motion-sensor API, press stop, download
 * the shared zip. Then run the analysis on that zip.
 *
 *   python -m analysis.synth /tmp/samples.json --app-samples Göztepe Kadıköy
 *   node tests/app_e2e.mjs app /tmp/samples.json /tmp/out     (needs playwright)
 *   python -m analysis.ride /tmp/out/<the zip>
 *
 * Desktop headless Chrome has no motion sensor, so a stand-in DeviceMotionEvent
 * is injected; Android Chrome provides the real one.
 */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const [ROOT, SAMPLES, OUT] = process.argv.slice(2);
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const b = await chromium.launch();
const ctx = await b.newContext({ acceptDownloads: true, locale: 'tr-TR', viewport: { width: 390, height: 844 } });
await ctx.route('**/*', r => { const u = new URL(r.request().url()); if (u.host !== 'site.test') return r.abort(); let f = path.join(ROOT, u.pathname.replace(/^\/app\/?/, '/') || '/'); if (f.endsWith('/')) f += 'index.html';
  return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] || 'application/octet-stream' }) : r.fulfill({ status: 404, body: '' }); });
await ctx.addInitScript(() => {
  // headless desktop Chrome has no motion sensor; stand in for Android's DeviceMotionEvent
  if (!('DeviceMotionEvent' in window)) {
    window.DeviceMotionEvent = class extends Event {
      constructor(type, init = {}) { super(type); this.acceleration = init.acceleration || null; this.accelerationIncludingGravity = init.accelerationIncludingGravity || null; this.interval = init.interval || 16; }
    };
  }
});
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && !/net::ERR_FAILED/.test(m.text()) && errs.push(m.text()));
await page.goto('http://site.test/app/');
await page.waitForSelector('.tile');
await page.click('.tile[data-line="M4"]');                       // tap the line tile
await page.click('#strip button:has-text("Göztepe")');            // where am I
await page.click('#strip button:has-text("Kadıköy")');            // where am I going
const dirText = await page.textContent('#cDir');
await page.click('.chip:has-text("Ön cepte")');
await page.screenshot({ path: OUT + '/app-setup.png' });
await page.click('#start');
await page.click('details.more summary');            // "add a note" is collapsed by default
await page.fill('#vehicle', '4012');
const s = JSON.parse(fs.readFileSync(SAMPLES));
// play the ride into the sensor API with faked event timestamps (as fast as possible)
await page.evaluate(({ t, a, g }) => {
  const base = performance.now();
  for (let i = 0; i < t.length; i++) {
    const withG = g ? { x: a[i][0] + g[i][0], y: a[i][1] + g[i][1], z: a[i][2] + g[i][2] } : null;
    const ev = new DeviceMotionEvent('devicemotion', { acceleration: { x: a[i][0], y: a[i][1], z: a[i][2] }, accelerationIncludingGravity: withG, interval: 20 });
    Object.defineProperty(ev, 'timeStamp', { value: base + t[i] * 1000 });
    window.dispatchEvent(ev);
  }
}, s);
await page.waitForTimeout(1200);
const live = { stops: await page.textContent('#nstops'), state: await page.textContent('#statetext'), hz: await page.textContent('#hz'), clock: await page.textContent('#elapsed') };
await page.screenshot({ path: OUT + '/app-recording.png' });
await page.click('#stop');
await page.waitForSelector('#rides .icon-btn');
await page.screenshot({ path: OUT + '/app-saved.png' });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rides .icon-btn:has-text("Paylaş")')]);
const zipPath = OUT + '/' + dl.suggestedFilename(); await dl.saveAs(zipPath);
console.log(JSON.stringify({ dirText, live, zip: zipPath, errs }));
await b.close();
