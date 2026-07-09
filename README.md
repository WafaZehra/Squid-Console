# 🦑 Squid — Anomaly Console

A tool that turns **any CSV** into a trained anomaly detector — no fixed schema, no manual preprocessing. Drop in a file, and a PyTorch autoencoder learns what "normal" looks like for that data, then flags the rows that don't fit, with an explanation of *why* each one was flagged.

![Python](https://img.shields.io/badge/Python-3.10+-blue)
![PyTorch](https://img.shields.io/badge/PyTorch-2.0+-EE4C2C)
![Flask](https://img.shields.io/badge/Flask-3.0+-black)
![License](https://img.shields.io/badge/license-MIT-green)

> Originally built around the classic [UCI Sonar dataset](https://archive.ics.uci.edu/dataset/151/connectionist+bench+sonar+mines+vs+rocks) (60 numeric features, rock-vs-mine classification). This version generalizes that pipeline to work on any tabular CSV — sensor logs, transaction records, lab data, anything.

## Demo

*(Add a screenshot or short GIF of the console here — the findings table and signal trace chart are the most visual parts.)*

## Why I built this

Most anomaly-detection notebooks are hardcoded to one dataset — fixed columns, a known label, a threshold picked by eye. I wanted something closer to a real tool: point it at any CSV, and it figures out the preprocessing, trains an autoencoder, picks a defensible threshold, and tells you *which features* drove each anomaly — not just a binary flag.

## How it works

1. **Preprocessing is automatic.** Numeric columns are standardized; categorical columns with a manageable number of categories are one-hot encoded; high-cardinality columns (like IDs) are dropped, with the pipeline logging every decision it makes.
2. **The model is a small autoencoder** (PyTorch): it compresses each row down to a bottleneck and reconstructs it. Rows that reconstruct poorly — high error — are the ones that don't match the patterns the model learned, i.e. anomalies.
3. **Two modes, chosen automatically:**
   - **Supervised** (if you mark a binary ground-truth column): the model trains only on rows labeled "normal," then the flagging threshold is chosen to maximize F1 against the real labels. Reports AUROC, precision, recall.
   - **Unsupervised** (the realistic case — no labels): trains on everything, and flags the top N% of rows by reconstruction error, where N is adjustable via three sensitivity presets (conservative / balanced / sensitive).
4. **Per-row explanations.** For every flagged row, the API reports which specific features contributed most to its reconstruction error — so a result isn't just "row 42 is anomalous," it's "row 42 is anomalous because of `feature_2` and `feature_7`."

## Features

- Works on any CSV — auto-detects header, column types, and missing values
- Dual-mode: supervised evaluation (AUROC/F1/precision/recall) or unsupervised flagging
- Three adjustable sensitivity presets for unsupervised mode
- Per-row feature attribution — see *why* a row was flagged, not just *that* it was
- Interactive console: signal trace, error distribution, training loss curve, sortable/searchable findings table, feature profile (normal vs. flagged stats per column)
- Export flagged rows to CSV
- No build step on the frontend — vanilla HTML/CSS/JS

## Tech stack

**Backend:** Python, Flask, PyTorch, pandas, scikit-learn (metrics only), NumPy
**Frontend:** HTML/CSS/vanilla JavaScript — no framework, no bundler

## Project structure

```
squid-console/
├── backend/
│   ├── app.py            Flask API (also serves the frontend)
│   ├── model.py           Preprocessing pipeline + autoencoder + scoring
│   ├── requirements.txt
│   └── sonar.csv           Sample dataset (UCI Sonar) to try it on immediately
└── frontend/
    ├── index.html
    ├── styles.css
    └── app.js               Handles upload, config, and rendering results
```

## Getting started

```bash
git clone https://github.com/<your-username>/squid-console.git
cd squid-console/backend
python3 -m venv venv && source venv/bin/activate   # optional but recommended
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:5000** — Flask serves both the API and the frontend, so there's nothing else to start. Try it immediately with the included `sonar.csv`.

## Using it

1. **Drop a CSV.** Any table works.
2. **Configure.** Confirm whether the first row is a header, optionally select a ground-truth label column, uncheck any columns that shouldn't feed the model (ID-like columns are pre-flagged), and set sensitivity if running unsupervised.
3. **Run scan.** The autoencoder trains on the backend and results stream back to the console.
4. **Read the results:**
   - **KPI strip** — rows scanned, features used, rows flagged, threshold used, and either AUROC/F1 (supervised) or final training loss (unsupervised)
   - **Signal trace** — every row's reconstruction error in order, with the threshold overlaid — the fastest way to see *where* the anomalies cluster
   - **Distribution histogram** and training loss curve
   - **Findings table** — sortable, searchable, paginated; expand any row to see its top contributing features
   - **Feature profile** — normal vs. flagged stats for every column
   - **System notes** — a log of every automatic preprocessing decision (columns dropped, values filled, encodings applied)
5. **Export** flagged rows to CSV.

## API reference

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/preview` | POST | Upload a CSV, get back column types, row count, and a preview |
| `/api/analyze` | POST | Run the full pipeline on a previously uploaded file (`file_id`), returns training metrics, threshold, per-row results, and feature summaries |

## Limitations

- Runs Flask's built-in dev server — fine for local/single-user use; put it behind gunicorn + nginx before exposing it to others
- Uploads are capped at 50MB and deleted from disk immediately after a scan completes or fails
- The signal trace chart downsamples past ~480 rows for rendering speed (max error per bin) — the findings table itself is never downsampled
- Trains on CPU unless a CUDA GPU is available to PyTorch on the host machine

## Possible extensions

- Job queue for large files instead of synchronous training
- Model persistence — save/reload a trained autoencoder instead of retraining per scan
- Dockerfile + basic CI (lint/test on push)

## License

MIT — see [LICENSE](LICENSE).
