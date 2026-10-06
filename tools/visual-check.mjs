/* Visual check: full-page screenshots of every page at desktop (1440) and phone (390) width,
 * plus console errors and horizontal-overflow detection. Used for the 2026-10-06 audit.
 *
 *   node tools/visual-check.mjs <site root> <out dir> <npm package dir> "" about board ...
 *
 * Serves the site from disk under http://site.test (clean URLs -> .html), maps unpkg/jsdelivr
 * npm URLs to a local folder of npm packages (for networks that block those CDNs), and feeds
 * the THY globe fake flight data. Needs playwright.
 */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const ROOT = process.argv[2], OUT = process.argv[3], PKGS = process.argv[4];
const pages = process.argv.slice(5);
const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.bin':'application/octet-stream','.mid':'audio/midi','.svg':'image/svg+xml','.xml':'application/xml','.txt':'text/plain'};
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy, args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
// fake live data so the globe has something to draw
const states = []; const cs=['THY1','THY35','THY6211','THY2014','THY77','THY1854','THY4AB','THY9'];
for (let i=0;i<60;i++) states.push(['4ba'+(100+i).toString(16), (cs[i%8]+i).padEnd(8), 'Turkey',0,0, -10+((i*37)%140), 10+((i*23)%50), 11000,false,240,(i*47)%360,0,null,11200,null,false,0]);
const report = {};
for (const vp of [{n:'desktop',width:1440,height:900},{n:'mobile',width:390,height:844}]) {
  const ctx = await browser.newContext({ viewport:{width:vp.width,height:vp.height}, ignoreHTTPSErrors:true, deviceScaleFactor:1, reducedMotion:'reduce' });
  await ctx.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.host === 'site.test') {
      let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
      let f = path.join(ROOT, p); if (!path.extname(f) && fs.existsSync(f+'.html')) f += '.html';
      if (!fs.existsSync(f)) f = path.join(ROOT,'404.html');
      return route.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)]||'application/octet-stream' });
    }
    let m = u.host==='unpkg.com' ? u.pathname.slice(1) : (u.host==='cdn.jsdelivr.net' && u.pathname.startsWith('/npm/')) ? u.pathname.slice(5) : null;
    if (m) { const f = path.join(PKGS, m); if (fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)]||'text/javascript', headers:{'access-control-allow-origin':'*'} }); return route.abort(); }
    if (u.host.endsWith('deno.net')) return route.fulfill({ body: JSON.stringify({ time: Math.floor(Date.now()/1000), states }), contentType:'application/json', headers:{'access-control-allow-origin':'*'} });
    if (/fonts\.(googleapis|gstatic)\.com$/.test(u.host)) return route.continue();
    return route.abort();
  });
  for (const pg of pages) {
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('pageerror: '+e.message.split('\n')[0]));
    page.on('console', m => { if (m.type()==='error' && !/ERR_FAILED|net::/.test(m.text())) errs.push('console: '+m.text().slice(0,160)); });
    try { await page.goto('http://site.test/'+pg, { waitUntil:'load', timeout:30000 }); } catch(e) { errs.push('goto: '+e.message.split('\n')[0]); }
    await page.waitForTimeout(2500);
    // scroll through to trigger reveal-on-scroll
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y=0; y<h; y+=vp.height/2) { await page.evaluate(y=>window.scrollTo(0,y), y); await page.waitForTimeout(120); }
    await page.evaluate(()=>document.querySelectorAll('[data-reveal]').forEach(e=>e.classList.add('visible')));
    await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => {
      const W = document.documentElement.clientWidth, out=[];
      for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.width && r.right > W+1 && getComputedStyle(el).position!=='fixed') { let ok=false; for (let p=el.parentElement;p;p=p.parentElement){const o=getComputedStyle(p).overflowX; if(o!=='visible'&&p!==document.body&&p!==document.documentElement){ok=true;break;}} if(!ok) out.push(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).join('.'):'')+' right='+Math.round(r.right)); } }
      return { scrollW: document.documentElement.scrollWidth, W, els: out.slice(0,8) };
    });
    const name = pg.replace(/\//g,'_')||'index';
    await page.screenshot({ path: `${OUT}/${vp.n}-${name}.png`, fullPage: true, timeout: 60000 }).catch(e=>errs.push('shot: '+e.message.split('\n')[0]));
    report[`${vp.n} ${pg||'/'}`] = { errs, overflow: overflow.scrollW > overflow.W ? overflow : undefined };
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
