# ParkSpot — defence plan (CV track, 7:00 + 3:00 Q&A)

Deck: [`docs/ParkSpot-defence.pptx`](ParkSpot-defence.pptx) — editable in PowerPoint, Google Slides or Canva
(Canva: Create a design → Import file). Speaker script is in each slide's notes. The earlier web version
(https://claude.ai/artifact/23gmGjtuh7Xy78vXWJooJE) does not show the map flow.
Mode on slide 1: **Startup** (change to "Partner product" + owning unit if the team decides so).

## Slide-by-slide (timing follows the organisers' recommended split)

| # | Slide | Speaker | Time | Criterion it serves |
|---|---|---|---|---|
| 1 | Cover: ParkSpot, mode, team | Bahridin | 0:00–0:15 | Presentation |
| 2 | Problem: driver, elderly driver, operator (payer) + our evidence | Bahridin | 0:15–1:00 | Impact |
| 3 | From one camera to the right spot: map, booking, walk-in, entrance screen, operator | Bahridin | 1:00–1:15 | Impact |
| 4 | **Live demo** — map, booking, jury's photo, operator | Bobur | 1:15–3:00 | Presentation, Technical |
| 5 | Pipeline: a system, not one model call | Amirxon | 3:00–3:30 | Technical |
| 6 | Replication test: 4 advantages | Amirxon | 3:30–4:10 | Innovation |
| 7 | Measured numbers (dev vs test set, honestly labelled) | Amirxon | 4:10–4:40 | Technical |
| 8 | Known failure cases (night) | Amirxon | 4:40–5:00 | Technical |
| 9 | Engineering constraints: where it runs, speed, cost/camera, night/rain | Amirxon | 5:00–5:15 | Technical, Business |
| 10 | Who pays, revenue, unit economics | Bahridin | 5:15–5:55 | Business, Impact |
| 11 | 3-month pilot, budget, payback | Bahridin | 5:55–6:30 | Business, Impact |
| 12 | Next steps + ask + thank you | Bahridin | 6:30–7:00 | Presentation |
| A | Backup: data, models, licences | any | Q&A | Technical |
| B | Backup: demo runbook | team | — | — |

Q&A owners: CV/model → Amirxon · app/demo/deploy → Bobur · business/pilot → Bahridin.

## Placeholders to fill before the defence (never with guesses)

- Slide 2: interviews / conversations / observed time-to-park — only what you actually collected.
- Slide 7, 9, A: Tashkent test-set size and results (from `/label` → `eval/evaluate.py`).
- Slides 9–11: server price per month, subscription price, booking fee, salaries, labelling cost,
  phone price, payback months — from real quotes, or say aloud "hypothesis for the pilot".
- Slide 1: speaker photos (replace the three circles).

## Visual direction

- Dark navy `#0F1A2B` for cover, demo and close (same colour as the entrance screen), light
  `#F4F7FB` for content slides; blue `#1F5FE0` = product, amber `#F2A93B` = emphasis / numbers.
- Arial throughout, so the deck looks the same in PowerPoint, Google Slides and Canva.
- Real screenshots of the running app only — no stock photos, no mock screens.
- One idea per slide; numbers big, with the measurement conditions in the footer.

## Demo plan

1. Map: the live lot (camera phone streaming) → Navigate opens Google Maps to the entrance → back.
2. Free spots & booking → book a free spot → sandbox pay → QR ticket → directions.
3. **Jury input** (Vision): their photo → cars, rows, inferred empty spots, time in ms.
4. Operator view (PIN): pixelated camera + spot overlay, one-time spot check, event log.
5. Close with "one CPU server, no GPU".

Live site: https://parkspot-5bo4.onrender.com (QR on slides 4 and 12). `/api/health` shows the running commit.

Before: open the site 10 minutes early (free server sleeps), tabs ready, one phone as backup,
2 lot photos on the laptop, **recorded backup video** offline: `docs/demo-backup.mp4` (63 s).
On the free server a photo takes ~1–3 s: say "free tenth-of-a-CPU server" while it runs. On failure: switch to the video at
the same step; never debug on stage.

## Likely questions (answers are in the slide notes)

- What is yours vs pretrained? → backup A; everything after detection is ours.
- Accuracy on new lots? → test-set row on slide 7 (Tashkent photos), not the dev set.
- Night? → slide 8: measured weakness, fix shipped, next step real night data.
- Cost per camera? → slide 9 formula with the real server price.
- Privacy? → no plates or faces stored; bookings enforced by spot occupancy + timing.
- Licences? → AGPL pretrained weights; retrain on own data before commercial use.
