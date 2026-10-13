# FA Full-Time automatic sync

This job checks the configured FA Full-Time pages every Sunday at **18:00 Europe/London** and writes the recognised data to the same Firebase paths used by the app and management portal.

## Rules applied

- Results involving Eastbourne United are ignored because those matches are managed manually.
- Only results labelled exactly `U13 Championship` affect `league_matches` and the league table.
- Other results are saved to `cup_matches` for the Other Clubs' Cup Results section.
- Only fixtures labelled exactly `U13 Championship` are imported.
- The league is restricted to the eight official U13 Championship teams configured in both tested importers.
- Existing records are updated using the Full-Time fixture ID. Date/team matching is used for older records that do not yet have that ID.
- Eastbourne fixture updates preserve scores, players, goals, assists, MOTM, match reports, photos and all matchday events.
- The job never deletes fixtures or results that disappear from the source page.
- If Full-Time blocks the request, returns an incomplete page, or no rows can be parsed, the sync stops without changing match data.

## cPanel cron and manual management sync

For cPanel, follow `CPANEL_SETUP.md`. The cPanel importer is pure PHP and needs no Node.js, npm or `proc_open`. Because FA Full-Time blocks the current hosting IP, it can use a ScraperAPI key to fetch the two public pages. The management portal's **Sync fixtures & results now** button and the Sunday cron still run the same tested PHP importer on cPanel.

## GitHub Actions manual backup

The repository includes `.github/workflows/fulltime-sync.yml` as a manually triggered backup. Add `SCRAPERAPI_API_KEY` as an Actions secret before running it from the Actions page.

Set these repository secrets if the Firebase database requires them:

- `FIREBASE_DATABASE_URL` — optional; defaults to the existing Eastbourne team database path.
- `FIREBASE_AUTH_TOKEN` — optional Firebase auth token.
- `SCRAPERAPI_API_KEY` — required for the backup workflow because FA Full-Time blocks datacentre IPs.

## Linux cron alternative

Install Node.js 20.18.1 or newer, then run:

```sh
cd automation
npm ci
npm test
npm run sync -- --dry-run
```

After checking the dry-run output, adapt the absolute path in `crontab.example` and add those lines to the server crontab.

## Useful commands

```sh
# Download and parse the live pages, but do not write Firebase
npm run sync -- --dry-run

# Run a live sync immediately
npm run sync

# Test saved HTML without contacting Full-Time or writing Firebase
npm run sync -- --dry-run --results-file test/fixtures-results.html --fixtures-file test/fixtures-list.html
```

Every live run records its outcome at `fulltime_sync_status` in Firebase. The management portal displays the latest successful run or failure in the Intelligent Fixture & Results Uploader.

## PHP tests

The cPanel implementation can be checked without Node.js:

```sh
php -l fulltime-sync-cpanel.php
php -l lib/fulltime-sync.php
php test/fulltime-sync-php.test.php
```
