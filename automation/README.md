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

## Windows Chrome bot (primary method)

FA Full-Time blocks the cPanel host, GitHub-hosted runners and the tested proxy service. Follow `DESKTOP_SETUP.md` to install the Windows bot. Its small unpacked extension reads the two public pages in the user's normal Chrome profile, then sends them to the local authenticated helper and existing tested Firebase merge logic.

The installer creates a Sunday 6pm Windows Scheduled Task plus a local authenticated helper for the management portal's **Run PC browser sync now** button. The PC must be switched on (or asleep), and the installing Windows user must be signed in.

The older cPanel and GitHub files are retained as reference/fallback implementations, but their external Full-Time requests are currently blocked and should not be scheduled.

## GitHub Actions legacy backup

The repository includes `.github/workflows/fulltime-sync.yml`, but FA Full-Time currently blocks the hosted runner/proxy route. Do not rely on it for the Sunday update.

Set these repository secrets if the Firebase database requires them:

- `FIREBASE_DATABASE_URL` — optional; defaults to the existing Eastbourne team database path.
- `FIREBASE_AUTH_TOKEN` — optional Firebase auth token.
- `SCRAPERAPI_API_KEY` — required for the backup workflow because FA Full-Time blocks datacentre IPs.

## Legacy direct-fetch commands

These remain useful for offline parser testing, but the live direct request is currently blocked by Full-Time:

```sh
cd automation
npm ci
npm test
npm run sync -- --dry-run
```

## Useful commands

```sh
# Ask normal Chrome and the EUYFC extension to run the sync
npm run desktop

# Start the authenticated local helper manually
npm run desktop-service

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
