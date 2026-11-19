# JRT Profit Forecast app — migration package

Made 2026-11-18. The rules for every calculation are in the doc
"JRT Profit Forecast App — Rules & Migration Guide" (in Claude, exportable to Word or PDF).
Keep that doc and this package together; update the doc's change log whenever a rule changes.

## src/
- engine.js      Spectrum report readers, profit forecast, monthly cash model (no screen code)
- app.js         Profit forecast tab, uploads, saving (save/load layer is the Claude-specific part)
- report.js      Bank & bonding report, liquidity, working capital, PDF/Excel
- lookahead.js   Cash lookahead tab, tab switching, start-up (boot() runs last)
- scorecard.js   Job scorecard (active and closed jobs)
- shell.html     Layout and styles
- build.js       `npm install && node build.js` -> index.html (one self-contained page)
- closed.json    Closed-job history, served next to index.html
- index.built.html  The exact page running in Claude today

## data/
- settings_jobs_divisions_likely.json  Live export 2026-11-18: forecast/settings, jobs/* (Sven's calls),
  divisions/* (overrides), likely/* (likely jobs)
- reports_*.json  The Spectrum reports as the app read them (WIP 9/30/26, October job cost, September P&L,
  10/31 AR and AP, Job Overview 11/17/26). Snapshot; re-upload the latest Spectrum files after cutover,
  or ask Claude for a fresh export on cutover day.

## To migrate
See "Migration checklist" in the guide. In short: replace the save/load calls in app.js
(saveReport, saveGlobal, saveJob, saveDiv, saveLikely and the onSnapshot listeners) with your database,
load data/, host closed.json, add sign-in, then match the check figures in the guide.
