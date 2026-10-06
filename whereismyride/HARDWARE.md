# Reference box — shopping list

A Raspberry Pi Zero W in a closed box on the carriage floor: the precise reference instrument next to the
phones. Buy in tiers; tier 1 alone is already useful.

Prices are rough USD guides from memory, not quotes — check current prices. In Turkey, Robotistan,
Direnc.net and Samm Market carry many Adafruit / SparkFun / Seeed boards; the ADXL355 usually comes from
Mouser or DigiKey (customs applies). Cheap clones of the Plantower and microphone boards exist on AliExpress;
quality varies, prefer genuine parts for anything you'll publish numbers from.

**Wiring choice:** boards with a **STEMMA QT / Qwiic** connector (Adafruit/SparkFun) plug together with
cables, no soldering per sensor. Only the Pi's 40-pin header needs soldering if yours has none.

---

## Tier 0 — make the Pi usable on the move (needed first)

| Item | Why | ~USD |
|---|---|---|
| 2×20 male pin header (if the Pi has none) + soldering iron | sensors connect through the header | 1 (+ iron) |
| microSD 32 GB, "High Endurance" type | continuous logging wears out normal cards | 10 |
| USB power bank, 10 000 mAh + micro-USB cable | whole box draws ~0.3–0.5 A → many hours per charge | 15–20 |
| STEMMA QT / Qwiic adapter for the Pi header (e.g. SparkFun Qwiic SHIM, or a STEMMA QT-to-pins cable) + 3–4 QT cables | plug-and-play I²C chain | 5–10 |
| DS3231 real-time clock board | keeps time between rides (the Pi has no clock and no internet underground) | 3–8 |
| Push button + LED | press = start/stop + a marker; LED = "recording" | 2 |

## Tier 1 — motion (the core measurement)

| Item | Measures | Why this one | ~USD |
|---|---|---|---|
| **ICM-42688-P** breakout (accel + gyro) | vibration up to kHz rates, rotation | low noise for its class, high sample rate, on-chip FIFO so the slow Pi doesn't drop samples; put it on **SPI** for headroom | 15–25 |
| **BMP390** breakout | air pressure, ~tens of cm resolution | depth profiles between stations, tunnel/passing-train pressure pulses | 10–12 |

## Tier 2 — air quality (nothing a phone can do)

| Item | Measures | Note | ~USD |
|---|---|---|---|
| **SCD41** CO₂ sensor (true NDIR) | CO₂ ppm + temperature + humidity | CO₂ rises with people breathing → **crowding**. Avoid cheap "eCO₂" chips (SGP30, CCS811): they estimate, they don't measure CO₂ | 45–60 |
| **PMS5003** (Plantower) + its cable/adapter | PM1 / PM2.5 / PM10 dust | metro dust from brakes and wheel–rail wear; serial (UART), 5 V, has a fan → intake must face out of the box | 20–35 |

## Tier 3 — upgrades, once tiers 1–2 work

| Item | Measures | When it's worth it | ~USD |
|---|---|---|---|
| **ADXL355** (e.g. EVAL-ADXL355-PMDZ) | very low-noise acceleration | if the ICM-42688-P's spectra look noise-limited — this is the vibration-measurement-grade part | 40–60 |
| **MMC5983MA** or **LIS3MDL** magnetometer | magnetic field, fast | traction-motor signatures at higher rate than the phone | 10–20 |
| **SPH0645** or **INMP441** I²S MEMS microphone | sound level | wheel squeal, noise comfort. Compute loudness on the Pi; **never store audio** (privacy) | 5–10 |
| **VEML7700** light sensor | light level | platform vs. tunnel; only if the box has a window | 5 |
| **Raspberry Pi Zero 2 W** | 4 cores instead of 1 | if the Zero W can't keep up with kHz IMU + air sensors together | 15–20 |

Not needed: GPS (the phone's dual-band GPS covers above-ground stretches).

## Box and mounting

| Item | Why |
|---|---|
| Closed ABS project box, roughly 15×10×5 cm | tidy, no loose wires in public |
| Anti-slip silicone/rubber mat under it + a small steel plate inside for weight | must not slide when the train brakes, or the vibration and braking numbers are wrong |
| Vent holes / mesh for SCD41 and PMS5003 | air sensors need outside air |
| Printed label: project name, university, contact | a box of electronics on a metro floor can worry people — make it obviously a student instrument |

**Before more than a few test rides: ask Metro İstanbul for permission** (student project, purpose, what the
box measures, no cameras/audio stored). Also a chance to start a useful contact.

## I²C addresses (no clashes in this list)

SCD41 0x62 · BMP390 0x77 (0x76 alt.) · DS3231 0x68 · VEML7700 0x10 · LIS3MDL 0x1C/0x1E · MMC5983MA 0x30.
ICM-42688-P would be 0x68/0x69 on I²C — **clashes with the DS3231 at 0x68** unless set to 0x69; on SPI
(recommended) the question doesn't arise.

## Rough totals

| | ~USD |
|---|---|
| Tier 0 | 35–50 |
| + Tier 1 | 25–40 |
| + Tier 2 | 65–95 |
| Tiers 0–2 (recommended start) | **~125–185** |
| Tier 3, all of it | +75–115 |

## Syncing the box with a phone

At the start of each ride, **tap the box and the phone together** (or tap the phone on the box lid). Both
accelerometers record the same sharp spike; the analysis lines the recordings up on it to within a few ms.
The DS3231 keeps the Pi's clock roughly right in between.
