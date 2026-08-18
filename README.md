# Academic Affairs Planning Calendar

A static, informational reference calendar that combines two sources of truth into one view:

1. **Official academic calendars** (Board of Trustees–approved PDFs) — absolute dates: term start/end, holidays, closures, breaks, commencement.
2. **The Academic Affairs scheduling cycle** — a term-relative process (e.g. *"Fall Week 4 — Individual instructor loads sent to divisions"*) that repeats every year regardless of which calendar year it lands in.

The app resolves the relative scheduling cycle against whichever academic year's calendar you select, generating an event on the correct absolute date — including correctly skipping holidays/closures when placing "beginning of week" and "end of week" milestones.

This is a reference tool only. It does not track task completion, require accounts, or store any data outside your own browser (`localStorage` is used only to remember your view/filter preferences).

## Live structure

```
index.html
css/
  styles.css
js/
  calendar.js     — pure date/term/business-day math
  events.js       — loads JSON, generates the unified event collection, filters
  storage.js      — localStorage preferences (per-browser, no accounts)
  app.js          — renders the UI: Today / Week / Month / Year / Scheduling Cycle
data/
  academic-years.json
  academic-calendars/
    2026-27.json
    2027-28.json
  scheduling-cycles/
    2026-27.json  — the canonical, reusable scheduling-cycle rules
```

**JSON is the source of truth. The app is a view of the data.** There is no build step, no framework, and no backend — it's plain HTML/CSS/JavaScript, deployable as-is to GitHub Pages or any static host.

## Running it locally

Browsers block `fetch()` of local JSON when a page is opened directly via `file://`, so serve the folder with any simple static server, for example:

```bash
python3 -m http.server 8000
```

then open `http://localhost:8000/`.

## Updating the data each year

### A new official calendar is approved
1. Convert the new PDF into a new `data/academic-calendars/YYYY-YY.json` file, following the schema of the existing files (`terms` + `calendarEvents`, each event tagged with `owner`, `category`, and `businessDayBlocking`).
2. Add a matching entry to `data/academic-years.json`.
3. Commit and push. No code changes needed — the existing scheduling-cycle rules apply automatically to the new year.

### The scheduling process itself changes
Edit `data/scheduling-cycles/2026-27.json` directly (the filename reflects when the rules were canonicalized, not the years they apply to — the same file drives every academic year loaded into the app). Each entry is `scheduleTerm` + `week` + `timing` (`start` / `end` / `unspecified`), plus `owner`, `audience`, `category`, and `relatedTerms`.

## Design notes

- **Palette** is adapted from the "Royal Romance" scheme (Carmine, Buttercup, Metallic Purple, Magenta Gem), re-tuned so every text/background pairing meets WCAG AA contrast.
- **Owner categories never rely on color alone** — each of the three owners (Academic Calendar, Academic Affairs, Academic Divisions) also has a distinct icon shape (circle, diamond, triangle) so the app remains usable for colorblind readers.
- **Holidays are visually distinct** from routine scheduling items: a gold star icon, a bold left-border stripe, a dedicated "Holiday" chip, a filled gold pill in Month view, and a star-shaped marker (instead of a plain diamond) on the Year ribbon.
- Keyboard navigation, visible focus states, and `prefers-reduced-motion` are all respected.
- The filter panel can be collapsed via the "Hide" button inside it or the header toggle, which is useful on smaller screens or when you just want more room for the calendar itself.

## Year switching and navigation bounds

- Selecting a different academic year jumps the Week/Month view to July of that year, rather than leaving you looking at a month that belongs to a different year's calendar.
- Week/Month "Previous"/"Next" navigation is clamped to the selected academic year (July through June) — the buttons disable at the edges instead of wandering into a year with no data loaded.
- If today's date falls outside the selected academic year, the Today view says so plainly and offers a one-click switch to whichever loaded year does contain today, rather than silently showing an empty, confusing screen.
- The year dropdown only ever lists years we have real calendar data for (see "Updating the data each year" below to add one). We deliberately don't auto-switch it on load beyond picking the year containing today, or preload every year in the background — with just a couple of years of data this keeps the behavior predictable; revisit this if the list of years grows.

## Known open decisions

A few defaults were chosen for this first build and are easy to revisit by editing the scheduling-cycle JSON — no code changes required:

- `unspecified` timing → first business day of the calculated week.
- Holidays (which now also include the former "Closure" and "Break" categories — see below) block business-day placement, except Spring Break specifically, which is flagged for display as a holiday but does **not** block business-day placement since the college isn't actually closed.
- The Fall/Spring Week 4 compliance checks (over/under load, DE certification, etc.) are owned by Academic Affairs with Divisions as audience.
- All scheduling events currently share one process grouping (`scheduling-cycle`) rather than being split into named sub-processes.
- The Term filter is disabled (commented out in `index.html`, defaulted to "all" in `app.js`) since hiding a term hid every scheduling-cycle item relative to it, which made the planner less useful. The markup and logic are left in place, so re-enabling it later is a small, contained change.
- Categories were consolidated for a cleaner sidebar: "Closure" and "Break" now live under **Holiday**, and "Commencement" now lives under **Other**.
