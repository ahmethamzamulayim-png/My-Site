"""Minimal client for İETT's SOAP web services (İBB Açık Veri Portalı).

Two calls are all the bus predictor needs:

    line_buses("2")  -> every bus on the line right now: door no., position,
                        route-direction code, nearest stop, time of last fix
    line_stops("2")  -> the line's stops in order, per direction

Method names and response fields as documented by İBB ("İETT Web Servis
Kullanım Dokümanı") and used in public examples:
    FiloDurum/SeferGerceklesme.asmx  GetHatOtoKonum_json(HatKodu)
    ibb/ibb.asmx                     DurakDetay_GYY(hat_kodu)
NOT yet run against the live service from here (blocked network) - the first
real run is the test. The services are reported to shut down nightly after
00:15, and to be slow; callers should expect errors and retry.

Plain `requests` + hand-built envelopes instead of a SOAP library: two calls
don't justify zeep, and this keeps the box at home dependency-light.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET

import requests

BASE = "https://api.ibb.gov.tr/iett"
NS = "http://tempuri.org/"  # ASP.NET .asmx default namespace; change here if the WSDL says otherwise
TIMEOUT = 30


def _soap(service: str, method: str, params: dict[str, str]) -> ET.Element:
    body = "".join(f"<{k}>{v}</{k}>" for k, v in params.items())
    envelope = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
        f'<soap:Body><{method} xmlns="{NS}">{body}</{method}></soap:Body></soap:Envelope>'
    )
    r = requests.post(
        f"{BASE}/{service}",
        data=envelope.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": f'"{NS}{method}"'},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return ET.fromstring(r.content)


def _result_text(root: ET.Element, method: str) -> str:
    for el in root.iter():
        if el.tag.endswith(f"{method}Result"):
            return el.text or ""
    raise ValueError(f"no {method}Result in response")


def parse_bus_positions(json_text: str) -> list[dict]:
    """GetHatOtoKonum_json's payload -> normalised rows."""
    out = []
    for b in json.loads(json_text or "[]"):
        try:
            out.append({
                "door": b.get("kapino"),
                "lat": float(b["enlem"]),
                "lon": float(b["boylam"]),
                "line": b.get("hatkodu"),
                "route": b.get("guzergahkodu"),  # e.g. "15B_G_D0" - G/D = the two directions
                "heading_to": b.get("yon"),
                "fix_time": b.get("son_konum_zamani"),  # "2023-01-23 12:41:54", local time
                "near_stop": str(b.get("yakinDurakKodu") or ""),
            })
        except (KeyError, TypeError, ValueError):
            continue  # a malformed row shouldn't drop the whole poll
    return out


def line_buses(line: str) -> list[dict]:
    root = _soap("FiloDurum/SeferGerceklesme.asmx", "GetHatOtoKonum_json", {"HatKodu": line})
    return parse_bus_positions(_result_text(root, "GetHatOtoKonum_json"))


def parse_line_stops(root: ET.Element) -> list[dict]:
    """DurakDetay_GYY's dataset -> stops sorted by direction and order."""
    rows = []
    for el in root.iter():
        children = {c.tag.split("}")[-1].upper(): (c.text or "").strip() for c in el}
        if "DURAKKODU" in children and "SIRANO" in children:
            try:
                rows.append({
                    "line": children.get("HATKODU"),
                    "direction": children.get("YON"),
                    "order": int(float(children["SIRANO"])),
                    "stop": children["DURAKKODU"],
                    "name": children.get("DURAKADI", ""),
                    "x": float(children["XKOORDINATI"]) if children.get("XKOORDINATI") else None,
                    "y": float(children["YKOORDINATI"]) if children.get("YKOORDINATI") else None,
                })
            except ValueError:
                continue
    return sorted(rows, key=lambda r: (r["direction"] or "", r["order"]))


def line_stops(line: str) -> list[dict]:
    return parse_line_stops(_soap("ibb/ibb.asmx", "DurakDetay_GYY", {"hat_kodu": line}))
