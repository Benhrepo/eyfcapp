# cPanel setup — Sunday 6pm FA Full-Time sync

> **Legacy only — do not enable this cron.** FA Full-Time currently blocks the cPanel address and the tested proxy fallbacks. Install the Windows Chrome bot in `DESKTOP_SETUP.md` instead, then disable any existing Full-Time cPanel cron. The PHP files remain here only for reference and offline testing.

The retained cPanel version runs entirely in PHP and does not require Node.js, npm or `proc_open`. The current management portal button now uses the Windows helper instead; the steps below describe the blocked legacy route only.

> The current hosting IP is blocked by FA Full-Time with HTTP 403. Create a free ScraperAPI account and add its key below; the PHP job then retrieves the two public pages through ScraperAPI while all parsing, duplicate protection and Firebase writes stay on cPanel.

## 1. Upload the files

Upload the changed-files package into the app's existing document root. For the current installation this is:

```text
/home/CPANEL_USERNAME/public_html/euyfcapp/
```

After extracting the package, this file must exist:

```text
/home/CPANEL_USERNAME/public_html/euyfcapp/automation/fulltime-sync-cpanel.php
```

The `automation` folder must sit beside the main `management.html`; do not extract it into another nested `euyfcapp` folder.

## 2. Check PHP and run the tests

Open **cPanel → Terminal** and run:

```sh
cd /home/CPANEL_USERNAME/public_html/euyfcapp/automation
/usr/local/bin/php -v
/usr/local/bin/php -m | grep -E 'curl|dom'
/usr/local/bin/php -l fulltime-sync-cpanel.php
/usr/local/bin/php -l lib/fulltime-sync.php
/usr/local/bin/php test/fulltime-sync-php.test.php
```

The extension check must show both `curl` and `dom`, and all four tests should pass. These are normal PHP extensions on cPanel; if either is absent, ask the hosting provider to enable PHP cURL and PHP DOM/XML.

## 3. Create the private cPanel configuration

In **cPanel → File Manager**:

1. Open `public_html/euyfcapp/automation`.
2. If dot-files are hidden, open **Settings** and enable **Show Hidden Files**.
3. Copy `.cpanel-sync-config.example.php`.
4. Name the copy `.cpanel-sync-config.php`.
5. Generate a private key in Terminal with `openssl rand -hex 32`.
6. Replace `sync_token` with that generated key.
7. Create a free account at `https://www.scraperapi.com/`, copy its API key and add it as `scraperapi_key`.
8. Save the file and set its permissions to `0600`.

The supplied `.htaccess` blocks browsers from downloading this private configuration. Do not put the sync key in `management.html`.

Example:

```php
<?php
return [
    'sync_token' => 'paste-the-generated-key-here',
    'scraperapi_key' => 'paste-the-scraperapi-key-here',
    'firebase_database_url' => '',
    'firebase_auth_token' => '',
    'fulltime_results_url' => '',
    'fulltime_fixtures_url' => ''
];
```

## 4. Test the management button

Open **Management Portal → Results Uploader → Sync fixtures & results now**. Enter the private `sync_token` from the configuration file. It is remembered only in that browser tab.

The status cards show:

- results and fixtures checked;
- Eastbourne results ignored;
- records added or corrected;
- the last successful run or any failure message.

## 5. Add the cPanel cron job

Only enable the cron after the management button succeeds through ScraperAPI.

Open **cPanel → Cron Jobs** and add:

| Field | Value |
|---|---|
| Minute | `0` |
| Hour | `17,18` |
| Day | `*` |
| Month | `*` |
| Weekday | `0` |

Command — replace `CPANEL_USERNAME` and, if needed, the PHP binary path:

```sh
/usr/local/bin/php -q /home/CPANEL_USERNAME/public_html/euyfcapp/automation/fulltime-sync-cpanel.php --cron >> /home/CPANEL_USERNAME/euyfc-fulltime-sync.log 2>&1
```

The two Sunday checks cover 17:00 and 18:00 on normal UTC/UK cPanel server timezones. The PHP job exits immediately unless it is actually **Sunday at 18:00 Europe/London**, so only one check performs the sync and the time remains correct through GMT and British Summer Time.

If the cPanel server uses a timezone other than UTC or Europe/London, use Hour `*` and Weekday `*` instead. The internal London-time guard still ensures the real scrape happens only on Sunday at 6pm.

## Troubleshooting

- **Configuration required:** `.cpanel-sync-config.php` is missing or misnamed.
- **Incorrect sync key:** the key entered in the portal does not exactly match `sync_token`.
- **PHP DOM or cURL missing:** enable PHP `dom`, `xml` and `curl` in cPanel's PHP extensions screen or ask the host.
- **Cloudflare blocked the server:** make sure `scraperapi_key` is present and correct in the private configuration.
- **Management portal reports HTTP 500:** first check the private configuration for a missing comma or quote:

  ```bash
  /usr/local/bin/php -l /home/cg6pfjcqdwjz/public_html/euyfcapp/automation/.cpanel-sync-config.php
  ```

  A successful check prints `No syntax errors detected`. The web endpoint allows up to six minutes for ScraperAPI to try safe standard, rendered and premium fallbacks for both Full-Time pages, and returns PHP startup failures to the portal as readable messages.
- **ScraperAPI HTTP error:** the importer automatically tries standard rendering, premium proxying, and premium rendering without relying on a brittle Full-Time CSS selector. Check the account's remaining monthly credits and API key in its dashboard. No match data is changed on a failed fetch.
- **Firebase 401/403:** add an appropriate `firebase_auth_token` to the private configuration.
