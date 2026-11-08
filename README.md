# Leikki

A bilingual, mobile-friendly guide to family activities for ages 0-8 in **Espoo, Helsinki and Vantaa**, free and paid. Every run collects **today through the end of next week**, using Finnish calendar dates: 8-14 days, including the whole following Monday-Sunday. The page hides past dates.

English and dark mode are the defaults; a dropdown switches language and an icon button toggles dark/day mode. Both, plus the selected child age, city and price filter, are remembered. The calendar strip shows one tab per day (today through next Sunday) and the page lists only the selected day's activities; the selected day is kept in the URL hash (e.g. `#2026-11-10`) so it can be shared. Filters are one row of compact dropdowns, in this order: child age (any single year 0-8), city (Espoo, Helsinki, Vantaa), price (any / free / paid), activity type (with counts for the selected day), plus order (recommended or by time). All dropdowns, including the language picker, use the site's own styled menus instead of the phone's native picker, with full keyboard support. Active filters are highlighted and a **Clear** link resets them. The indoor/outdoor setting filter was dropped because most source events do not state it; known settings still appear as card tags. The day tabs and filter row stay pinned to the top while scrolling; on phones the headline is hidden and the filter row scrolls sideways to save vertical space. A floating button in the lower-right corner returns to the top.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm test
npm run update
npm run serve
```

Open http://localhost:4173. The root `index.html` fetches `data/activities.json`, so use HTTP rather than opening it as a `file:` URL.

## Vercel

Import this repository into Vercel. Choose **Other** as the framework, leave the build command empty, and use the repository root (`.`) as the output directory. No server, runtime secrets, or frontend build is needed. Deploy the initial data snapshot along with the HTML. New snapshot commits trigger deployment through the Vercel Git integration.

## Daily GitHub bot

The workflow runs **daily at 06:00 UTC** (08:00 in Finnish winter, 09:00 in summer), and supports manual runs under **Actions > Update family activities > Run workflow**. Daily updates replace the original weekly schedule so that a new full next-week buffer is collected after the week changes. GitHub schedules can be delayed, disabled, or fail: the page warns when its saved range cannot cover the whole next week. This is not a guarantee of uninterrupted coverage or activities every day.

Push these files to the default branch and enable GitHub Actions. The workflow needs permission to write repository contents; branch protection may require an exception for the bot. On public repositories, GitHub can disable scheduled workflows after 60 days without repository activity. Check workflow health periodically. No commit or push is performed by the local update command.

## Sources and inclusion rules

Automatic collection uses the official [Espoo Events API](https://api.espoo.fi/events/v1/) and the [Linked Events API](https://api.hel.fi/linkedevents/v1/) (queried with `division=espoo,helsinki,vantaa`). **Only venues in the municipalities of Espoo, Helsinki and Vantaa are accepted**, and each event is labelled with its city; finer district/area tags are no longer used. Duplicates published in both feeds are merged. Coverage depends on what organisers publish: Vantaa content in Linked Events is mostly Helmet library events, so Vantaa has far fewer listings than Helsinki. Vantaa's own calendar (tapahtumat.vantaa.fi) has no documented public API and is linked rather than scraped.

The collapsed directory links to the city calendars, free family places (MLL, Aurora, Vantaa resident parks) and **commercial indoor play parks** (Leo's Espoo and Helsinki, SuperPark, Leikkiluola). These venues work on opening hours, not dated events, so they are listed as links only, without prices or hours. **Browsing links are not automatically collected or verified sessions.** MLL local websites and recurring venue opening hours need dedicated adapters before they can appear as dated results. Login-only social media is not scraped.

Only scheduled individual occurrences within the collected period are included. Recurring parent containers, cancelled/deleted events, school/daycare-only bookings, events outside the three cities, and known age ranges not overlapping 0-8 are excluded. Infant sessions are now included. Age guidance uses numeric metadata, explicit age ranges, baby-only titles, and clearly stated school grades. Each event gets a price status: **free** (every offer is marked free), **paid** (any offer is not free; the organiser's price text and ticket link are shown when given), or **unknown** (no offer data; flagged on the card). A free event whose description mentions an admission fee or museum ticket, without stating free entry, is treated as paid ("Admission fee"). Paid listings include term courses with large fees, so check the original page. Always confirm conditions on the original page; organiser metadata can be incomplete or wrong.

Unknown ages remain flagged and appear under every age filter as possible matches, not confirmed recommendations for that age. Settings are taken from explicit descriptions. The city comes from the venue's municipality in the source data; no geocoding is used.

Activity categories are keyword-based suggestions, not verified physical-intensity ratings. Original titles and descriptions use official English/Finnish fields where available. Missing translations retain labelled original text; the site does not pretend to provide a full translation. Event language is shown separately in the details.

## Recommendation stars

Each card shows a 0-5 star recommendation (half-star steps; 20 points = 1 star) computed from a transparent heuristic score out of 100. These are **not parent reviews, popularity, safety ratings, or guarantees**. They favour free active play and clear practical information, so paid events rank somewhat lower by design. Every card provides its breakdown under **Why this rating?**:

- 30 points: explicitly free; or 20 points: paid with the price stated up front (paid without a price, or unknown price, earns nothing).
- Activity type: 30 movement, 25 play, 20 creative, or 15 quiet.
- 15 points: age guidance is available.
- 10 points: a dated session lasts 30-120 minutes.
- 10 points: the description explicitly says no advance registration is required.
- 5 points: the venue is named.

Missing information earns no points. Scores do not assess staff quality, crowds, travel distance, or a child's personal preferences. An age match only requires the chosen age to fall inside the stated range; check the exact ages on the card. You can switch from recommended ordering to starting time.

Every card links to its original city event page. Data attribution follows the APIs' CC BY 4.0 terms. Event photographs are shown only when permitted license metadata and photographer attribution are available; `event_only` images are used only on their own event cards.

## Failures and checks

Each feed is collected completely before its result is accepted. If one feed fails, compatible previous events from that feed within the new period are retained and marked outdated. The workflow publishes the partial snapshot, then reports the failure. If all feeds fail, it leaves the previous file unchanged and fails. The webpage detects insufficient next-week coverage and snapshots older than 36 hours, and never silently changes event dates. Errors appear in Actions logs and the job summary.

```sh
npm test
NOW=2026-11-08T10:00:00Z npm run update
```

`NOW` is an optional collector date override for reproducing a particular week. It must not be set in the scheduled workflow.
