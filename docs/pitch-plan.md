# ParkDet — defence plan (CV track, 7:00 + 3:00 Q&A)

Deck: [`docs/ParkDet-defence.pptx`](ParkDet-defence.pptx) — editable in PowerPoint, Google Slides or Canva
(Canva: Create a design → Import file). Speaker script, timing and sources are in each slide's notes.
Mode on slide 1: **Startup**. ParkDet = **Park**ing **Det**ector — "free parking spots, seen live".

## Slide-by-slide (7:00, hard stop)

| # | Slide | Speaker | Time | Criterion it serves |
|---|---|---|---|---|
| 1 | Cover: ParkDet = Parking Detector, mode, team | Bahridin | 0:00–0:15 | Presentation |
| 2 | Problem → solution (3 problems, 4 answers) | Bahridin | 0:15–1:00 | Impact |
| 3 | **Live demo** — map, booking, jury's photo, operator | Bobur | 1:00–3:00 | Presentation, Technical |
| 4 | Technology: how it works, measured, real conditions, accuracy, open models vs ours | Amirxon | 3:00–4:45 | Technical, Innovation |
| 5 | Competitors in Uzbekistan: strong and weak points vs ParkDet | Amirxon | 4:45–5:30 | Innovation, Business |
| 6 | Business model + 3-month pilot + our ask | Bahridin | 5:30–7:00 | Business, Impact |

The team-only demo runbook is in the notes of slide 4. Q&A owners: CV/model → Amirxon ·
app/demo/deploy → Bobur · business/pilot → Bahridin.

## Placeholders to fill before the defence (never with guesses)

- Slide 4: accuracy on our own Tashkent photos (`/label` → `eval/evaluate.py` → `/quality`).
- Slide 6: subscription price, booking fee, server price, phone price, pilot cost, payback months —
  from real quotes, or say aloud "hypothesis for the pilot"; the pilot lot (e.g. WIUT).
- Slide 2 (spoken only): one sentence of real evidence, if the team has it.
- Slide 1: speaker photos (replace the three circles).

## Competitor sources (slide 5; checked 10 Oct 2026 from search results — open each once)

- Poytaxt Parking: https://www.spot.uz/ru/2025/06/23/paid-parking/ ·
  https://kun.uz/ru/news/2025/05/05/v-tashkente-v-testovom-rejime-zapushcheny-pervyye-pridorojnyye-platnyye-parkovki ·
  https://www.afisha.uz/ru/gorod/2025/05/06/parking
- Airport gate system (2022): https://kun.uz/ru/news/2022/11/24/v-aeroportu-tashkenta-zarabotala-pervaya-umnaya-parkovka-v-strane ·
  https://anhor.uz/news/smart-parking/ · https://www.spot.uz/ru/2023/01/09/parking-airport/
- Airport tender (May 2026): https://www.spot.uz/ru/2026/05/04/airport-parking-lease/ · https://anhor.uz/news/parkovki-2/
- City traffic centre pilot (Apr 2026): https://kun.uz/ru/news/2026/04/21/v-tashkente-pristupili-k-realizatsii-pilotnogo-proyekta-po-sistemnomu-upravleniyu-parkovkami
- Maps: https://yandex.com/maps · https://2gis.uz
- Per-spot guidance product: Hikvision Smart Parking solution brochure (hikvision.com); no Uzbek installation found.

"Not found" means not found in our search — say "we found no…", never "there is no…".

## Visual direction

- Dark navy `#0F1A2B` for cover and demo, light `#F4F7FB` for content slides; blue `#1F5FE0` =
  product, amber `#F2A93B` = emphasis (and the PARK / DET letters on the cover).
- Arial throughout, so the deck looks the same in PowerPoint, Google Slides and Canva.
- Real screenshots of the running app only (UI, no camera pictures) — no stock photos, no mock screens.

## Demo plan

1. Map: the live lot (camera phone streaming) → Navigate opens Google Maps to the entrance → back.
2. Free spots & booking → book a free spot → sandbox pay → QR ticket → directions.
3. **Jury input** (Vision): their photo → cars, rows, inferred empty spots, time in ms.
4. Operator view (PIN): pixelated camera + spot overlay, one-time spot check, event log.
5. Close with "one CPU server, no GPU".

Live site: https://parkspot-5bo4.onrender.com (QR on slide 3). `/api/health` shows the running commit.

Before: open the site 10 minutes early (free server sleeps), the WIUT camera phone streaming (one
picture every 5–10 s on the free server), 2 lot photos on the laptop, and your own screen recording
of the flow offline as a backup. On the free server a photo takes ~3 s: say "free tenth-of-a-CPU
server" while it runs. On failure: switch to the recording at the same step; never debug on stage.

## Likely questions (answers are in the slide notes)

- What is yours vs pretrained? → slide 4 strip; everything after detection is ours.
- Accuracy on new lots? → slide 4 accuracy card (our Tashkent photos).
- Night? → second, brightened view; real night photos still to measure.
- Cost per camera? → slide 6 formula with the real server price.
- Privacy? → pictures never saved, operator view pixelated, no plates read, drivers never see the camera.
- Licences? → AGPL pretrained weights; retrain on own data before commercial use (README).
- Why not sensors or gates? → slide 5: one device per spot vs one phone per lot; gates don't know which spot is free.
