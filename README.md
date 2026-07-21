# Cortex — Cloud9 demo

Single-file, client-side demo for the Cloud9 Deal Room pitch. No backend, no
build step, no dependencies — just open `index.html`.

## What it does
- **Exec Deck** — paste or upload a CRM/ERP CSV; builds a leadership-ready exec
  deck in seconds, every number explainable. Runs are logged to the audit trail.
- **Forecast** — moving-average demand forecast with a confidence band.
- **Data Protection** — auto-redacts SSN, card/PAN, account, IBAN, email, phone.
- **Audit Trail** — tamper-evident, hash-chained log with one-click integrity
  verification and CSV/JSON export.
- **Monitor / Automate** — anomaly scan and configurable busywork rules.
- 3D interactive hero rendered with plain Canvas (no libraries).

Built by team **Cloud9**.

## Run locally
Open `index.html` directly, or serve the folder:

    python3 -m http.server 8000
    # then visit http://localhost:8000

## Deploy

### GitHub Pages
1. Repo → **Settings** → **Pages**
2. **Source: Deploy from a branch**
3. Branch **`main`**, folder **`/ (root)`** → **Save**
4. Wait ~1–2 min → https://harshseth.github.io/cloud9-demo/

Deep link straight to the audit tab: `https://harshseth.github.io/cloud9-demo/#audit`

### Netlify Drop (fastest, no account)
Drag `index.html` onto https://app.netlify.com/drop for an instant HTTPS URL.
