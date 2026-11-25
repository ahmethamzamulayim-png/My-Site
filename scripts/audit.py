#!/usr/bin/env python3
"""Static site audit for ahmethmzamlym.engineer.

Run locally or in CI to catch regressions before deploy:
  - UTF-8 & JSON syntax across every .json file
  - Zero broken local links, assets, or .html extensions on internal links
  - EN <-> /tr/ page parity, canonical, hreflang, and sitemap.xml completeness
  - Zero relative asset paths in JSON/HTML that would break under /tr/ or nested 404s
  - Image width/height attributes matching actual file aspect ratios (no CLS)
  - Complete Open Graph metadata (og:title, og:description, og:url, og:image + dimensions + alt)
  - Accessible <button type=...>, single <h1>, no duplicate IDs, skip link present
  - JS syntax check via `node --check` on every external .js and inline <script>
  - Reducer manifest.json <-> reducer/models/*.glb parity & WIMR data-k key check
"""

import json
import os
import re
import struct
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_ORIGIN = "https://ahmethmzamlym.engineer"


class PageInspector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.html_lang = None
        self.metas = []
        self.links = []
        self.scripts = []
        self.inline_scripts = []
        self.imgs = []
        self.anchors = []
        self.buttons = []
        self.model_viewers = []
        self.ids = []
        self.h1_count = 0
        self.headings = []
        self.has_skip_link = False
        self._in_script = False
        self._script_attrs = {}
        self._script_buf = []

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag == "html":
            self.html_lang = d.get("lang")
        elif tag == "meta":
            self.metas.append(d)
        elif tag == "link":
            self.links.append(d)
        elif tag == "script":
            self.scripts.append(d)
            if "src" not in d and d.get("type") not in ("application/ld+json", "importmap"):
                self._in_script = True
                self._script_attrs = d
                self._script_buf = []
        elif tag == "img":
            self.imgs.append(d)
        elif tag == "a":
            self.anchors.append(d)
            if "skip-link" in (d.get("class") or "").split():
                self.has_skip_link = True
        elif tag == "button":
            self.buttons.append(d)
        elif tag == "model-viewer":
            self.model_viewers.append(d)
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            lvl = int(tag[1])
            self.headings.append(lvl)
            if lvl == 1:
                self.h1_count += 1
        if "id" in d:
            self.ids.append(d["id"])

    def handle_endtag(self, tag):
        if tag == "script" and self._in_script:
            self._in_script = False
            self.inline_scripts.append((self._script_attrs, "".join(self._script_buf)))

    def handle_data(self, data):
        if self._in_script:
            self._script_buf.append(data)


def get_img_size(path: Path):
    data = path.read_bytes()
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data):
            while i < len(data) and data[i] == 0xFF:
                i += 1
            if i >= len(data):
                break
            marker = data[i]
            i += 1
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack(">HH", data[i + 3 : i + 7])
                return w, h
            if marker in (0xD8, 0xD9, 0x01) or (0xD0 <= marker <= 0xD7):
                continue
            length = struct.unpack(">H", data[i : i + 2])[0]
            i += length
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X":
            w = 1 + int.from_bytes(data[24:27], "little")
            h = 1 + int.from_bytes(data[27:30], "little")
            return w, h
        if chunk == b"VP8 ":
            w, h = struct.unpack("<HH", data[26:30])
            return w & 0x3FFF, h & 0x3FFF
        if chunk == b"VP8L":
            b0, b1, b2, b3 = data[21:25]
            w = 1 + (((b1 & 0x3F) << 8) | b0)
            h = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
            return w, h
    return None


def resolve_local(page_path: Path, ref: str):
    if not ref or ref.startswith(("http://", "https://", "mailto:", "tel:", "data:", "javascript:", "#")):
        return None
    if "${" in ref:
        return None
    clean = ref.split("#")[0].split("?")[0]
    if not clean:
        return None
    cand = (ROOT / clean.lstrip("/")) if clean.startswith("/") else (page_path.parent / clean).resolve()
    if cand.is_file():
        return cand
    if cand.is_dir() and (cand / "index.html").is_file():
        return cand / "index.html"
    if (cand.parent / (cand.name + ".html")).is_file():
        return cand.parent / (cand.name + ".html")
    return ("MISSING", str(cand))


def main() -> int:
    errors = []
    html_files = sorted([p for p in ROOT.glob("*.html")] + [p for p in (ROOT / "tr").glob("*.html")])

    # 1. EN <-> TR page parity & sitemap completeness
    en_pages = {p.name for p in ROOT.glob("*.html") if p.name != "404.html"}
    tr_pages = {p.name for p in (ROOT / "tr").glob("*.html")}
    if en_pages != tr_pages:
        errors.append(f"EN/TR page mismatch: en_only={sorted(en_pages - tr_pages)}, tr_only={sorted(tr_pages - en_pages)}")

    sitemap_urls = set(re.findall(r"<loc>(.*?)</loc>", (ROOT / "sitemap.xml").read_text(encoding="utf-8")))
    expected_urls = set()
    for name in en_pages:
        slug = "" if name == "index.html" else name[:-5]
        expected_urls.add(f"{SITE_ORIGIN}/{slug}")
        expected_urls.add(f"{SITE_ORIGIN}/tr/{slug}")
    if expected_urls - sitemap_urls:
        errors.append(f"Missing from sitemap.xml: {sorted(expected_urls - sitemap_urls)}")
    if sitemap_urls - expected_urls:
        errors.append(f"Extra URLs in sitemap.xml: {sorted(sitemap_urls - expected_urls)}")

    # 2. Validate every JSON file as strict UTF-8 JSON & check for relative asset paths
    for jf in sorted(ROOT.rglob("*.json")):
        if ".git" in jf.parts or ".vscode" in jf.parts:
            continue
        rel = jf.relative_to(ROOT).as_posix()
        try:
            txt = jf.read_text(encoding="utf-8")
            json.loads(txt)
        except Exception as exc:
            errors.append(f"Invalid UTF-8/JSON in {rel}: {exc}")
            continue
        for m in re.finditer(r'"((?:assets|metro|reducer|bearing|bearing-universal)/[^"]+)"', txt):
            errors.append(f"Relative asset path in {rel}: {m.group(1)} (must start with /)")

    # 3. Reducer manifest <-> .glb models parity
    manifest = json.loads((ROOT / "reducer/manifest.json").read_text(encoding="utf-8"))
    manifest_glbs = {row["glb"] for row in manifest}
    actual_glbs = {p.name for p in (ROOT / "reducer/models").glob("*.glb")}
    if manifest_glbs != actual_glbs:
        errors.append(
            f"Reducer manifest/model mismatch: missing={sorted(manifest_glbs - actual_glbs)}, extra={sorted(actual_glbs - manifest_glbs)}"
        )

    # 4. WIMR [data-k] keys
    W = json.loads((ROOT / "metro/wimr.json").read_text(encoding="utf-8"))
    BUS = json.loads((ROOT / "metro/bus.json").read_text(encoding="utf-8"))
    derived_keys = {
        "derived.I_amp", "derived.q80", "derived.q80_m", "derived.lin_pct",
        "derived.repeat", "derived.km", "derived.drop_jkg",
        "bus.pct.f1s", "bus.pct.f1e", "bus.pct.i1e", "bus.pct.direct",
        "bus.pct.direct_lo", "bus.pct.direct_hi", "bus.pct.fb1",
        "bus.pct.fb2", "bus.pct.ov2", "bus.pred.f1", "bus.pred.f2",
    }

    def resolve_k(path_key: str) -> bool:
        if path_key in derived_keys:
            return True
        root, rest = (BUS, path_key[4:]) if path_key.startswith("bus.") else (W, path_key)
        cur = root
        for part in rest.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return False
        return cur is not None

    for wf in ("wimr.html", "tr/wimr.html"):
        for k in re.findall(r'data-k="([^"]+)"', (ROOT / wf).read_text(encoding="utf-8")):
            if not resolve_k(k):
                errors.append(f"{wf}: unresolved data-k='{k}'")

    # 5. External JS syntax checks
    js_files = (
        list(ROOT.glob("*.js"))
        + list((ROOT / "metro").glob("*.js"))
        + list((ROOT / "reducer").glob("*.js"))
    )
    for jsf in sorted(js_files):
        res = subprocess.run(["node", "--check", str(jsf)], capture_output=True, text=True)
        if res.returncode != 0:
            errors.append(f"JS syntax error in {jsf.relative_to(ROOT).as_posix()}: {res.stderr.strip()}")

    # 6. Per-page HTML checks
    for p in html_files:
        rel = p.relative_to(ROOT).as_posix()
        txt = p.read_text(encoding="utf-8")
        pi = PageInspector()
        pi.feed(txt)
        is_tr = rel.startswith("tr/")
        is_404 = rel == "404.html"

        # <html lang>
        expected_lang = "tr" if is_tr else "en"
        if pi.html_lang != expected_lang:
            errors.append(f"{rel}: <html lang='{pi.html_lang}'> expected '{expected_lang}'")

        # Duplicate IDs
        seen = set()
        for elem_id in pi.ids:
            if elem_id in seen:
                errors.append(f"{rel}: duplicate id='{elem_id}'")
            seen.add(elem_id)

        # Single <h1> and skip link
        if pi.h1_count != 1:
            errors.append(f"{rel}: expected 1 <h1>, found {pi.h1_count}")
        if not pi.has_skip_link:
            errors.append(f"{rel}: missing .skip-link")

        # Umami analytics
        if not any("umami" in (s.get("src") or "") for s in pi.scripts):
            errors.append(f"{rel}: missing Umami analytics script")

        # No dead langchange / data-i18n leftovers
        if "langchange" in txt:
            errors.append(f"{rel}: dead langchange listener present")
        if "data-i18n" in txt:
            errors.append(f"{rel}: dead data-i18n attribute present")

        # Buttons must declare type
        for btn in pi.buttons:
            if "type" not in btn:
                errors.append(f"{rel}: <button> missing type attribute ({btn})")

        # Relative asset paths in stylesheets/scripts
        for l in pi.links:
            if l.get("rel") not in ("canonical", "alternate", "preconnect"):
                href = l.get("href", "")
                if href and not href.startswith(("http://", "https://", "/", "data:")):
                    errors.append(f"{rel}: relative <link> href '{href}'")
                res = resolve_local(p, href)
                if isinstance(res, tuple):
                    errors.append(f"{rel}: broken <link> '{href}'")
        for s in pi.scripts:
            src = s.get("src", "")
            if src and not src.startswith(("http://", "https://", "/")):
                errors.append(f"{rel}: relative <script> src '{src}'")
            res = resolve_local(p, src)
            if isinstance(res, tuple):
                errors.append(f"{rel}: broken <script> '{src}'")

        # Images: existence, alt, width/height & aspect ratio
        for img in pi.imgs:
            src = img.get("src", "")
            if "alt" not in img:
                errors.append(f"{rel}: <img> missing alt: {src}")
            if not img.get("width") or not img.get("height"):
                errors.append(f"{rel}: <img> missing width/height: {src}")
            res = resolve_local(p, src)
            if isinstance(res, tuple):
                errors.append(f"{rel}: broken <img> '{src}'")
            elif isinstance(res, Path) and img.get("width") and img.get("height"):
                actual = get_img_size(res)
                if actual:
                    aw, ah = actual
                    tw, th = int(img["width"]), int(img["height"])
                    if abs((aw / ah) - (tw / th)) / (aw / ah) > 0.03:
                        errors.append(f"{rel}: aspect mismatch on {src} (tag={tw}x{th}, actual={aw}x{ah})")

        # Anchors: local resolution, no .html, rel on _blank, TR->EN leak check
        for a in pi.anchors:
            href = a.get("href", "")
            if a.get("target") == "_blank":
                rel_tokens = (a.get("rel") or "").lower().split()
                if "noopener" not in rel_tokens and "noreferrer" not in rel_tokens:
                    errors.append(f"{rel}: target=_blank without noopener/noreferrer: {href}")
            if not href.startswith(("http://", "https://", "mailto:", "tel:", "#")) and ".html" in href:
                errors.append(f"{rel}: internal link has .html extension: {href}")
            res = resolve_local(p, href)
            if isinstance(res, tuple):
                errors.append(f"{rel}: broken <a> '{href}'")
            if is_tr and "lang-toggle" not in (a.get("class") or "").split():
                if href.startswith("/") and not href.startswith(("/tr/", "/assets/", "/bearing/", "/reducer/", "/metro/")):
                    errors.append(f"{rel}: Turkish page links to English URL '{href}'")

        # Meta / OG / Canonical / Hreflang / JSON-LD (all non-404 pages)
        if not is_404:
            meta_names = {m.get("name"): m.get("content") for m in pi.metas if m.get("name")}
            meta_props = {m.get("property"): m.get("content") for m in pi.metas if m.get("property")}
            for req in ("description", "twitter:card", "twitter:image"):
                if not meta_names.get(req):
                    errors.append(f"{rel}: missing meta name='{req}'")
            for req in ("og:type", "og:title", "og:description", "og:url", "og:image", "og:image:width", "og:image:height", "og:image:alt"):
                if not meta_props.get(req):
                    errors.append(f"{rel}: missing meta property='{req}'")

            og_img = meta_props.get("og:image", "")
            if og_img.startswith(SITE_ORIGIN + "/"):
                og_file = ROOT / og_img[len(SITE_ORIGIN) + 1 :]
                if not og_file.is_file():
                    errors.append(f"{rel}: og:image file missing: {og_img}")
                else:
                    actual = get_img_size(og_file)
                    if actual and meta_props.get("og:image:width") and meta_props.get("og:image:height"):
                        if (int(meta_props["og:image:width"]), int(meta_props["og:image:height"])) != actual:
                            errors.append(f"{rel}: og:image dimensions mismatch (meta={meta_props['og:image:width']}x{meta_props['og:image:height']}, actual={actual[0]}x{actual[1]})")

            slug = "" if p.name == "index.html" else p.name[:-5]
            exp_en = f"{SITE_ORIGIN}/{slug}"
            exp_tr = f"{SITE_ORIGIN}/tr/{slug}"
            exp_canon = exp_tr if is_tr else exp_en
            canons = [l.get("href") for l in pi.links if l.get("rel") == "canonical"]
            if canons != [exp_canon]:
                errors.append(f"{rel}: canonical={canons} expected [{exp_canon}]")
            if meta_props.get("og:url") != exp_canon:
                errors.append(f"{rel}: og:url={meta_props.get('og:url')} expected {exp_canon}")

            hreflangs = {l.get("hreflang"): l.get("href") for l in pi.links if l.get("rel") == "alternate" and l.get("hreflang")}
            if hreflangs.get("en") != exp_en or hreflangs.get("tr") != exp_tr or "x-default" not in hreflangs:
                errors.append(f"{rel}: incomplete hreflang={hreflangs}")

            for idx, m in enumerate(re.finditer(r'<script type="application/ld\+json">(.*?)</script>', txt, re.S)):
                try:
                    json.loads(m.group(1))
                except Exception as exc:
                    errors.append(f"{rel}: invalid JSON-LD[{idx}]: {exc}")

        # Inline JS syntax validation
        for idx, (attrs, code) in enumerate(pi.inline_scripts):
            ext = ".mjs" if attrs.get("type") == "module" else ".js"
            with tempfile.NamedTemporaryFile("w", suffix=ext, delete=False, encoding="utf-8") as tf:
                tf.write(code)
                tpath = tf.name
            try:
                res = subprocess.run(["node", "--check", tpath], capture_output=True, text=True)
                if res.returncode != 0:
                    errors.append(f"{rel}#script[{idx}] JS syntax error: {res.stderr.strip()}")
            finally:
                os.unlink(tpath)

    if errors:
        print(f"AUDIT FAILED ({len(errors)} issue{'s' if len(errors) != 1 else ''}):")
        for err in errors:
            print(f"  - {err}")
        return 1

    print(f"AUDIT PASSED: {len(html_files)} HTML pages, {len(js_files)} JS files, {len(manifest)} reducer models verified with 0 errors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
