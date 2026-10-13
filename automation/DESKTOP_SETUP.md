# Windows Chrome bot setup

This is the primary FA Full-Time sync method. A small unpacked extension opens the public results and fixtures pages inside your normal Chrome profile, follows every enabled next-page control, combines all pages and passes the visible match data to a private helper on this PC. The helper uses the same duplicate checks and safe merge code already used by the app.

The bot writes to the app's existing Firebase paths. One successful run therefore updates the management portal, public app, league table, other clubs' cup results and fixtures together.

Eastbourne's U13 Championship fixtures are checked in both the team schedule and shared league fixture list. Eastbourne results remain manual. Empty league fixtures missing from the complete official schedule are proposed for removal, while completed games, fixtures with matchday data, cup games and custom fixtures are preserved. No proposed change goes live until it is approved in the management portal.

## Before installation

- Install the current **Node.js LTS** release from <https://nodejs.org/> if `node --version` does not work in PowerShell.
- Keep the extracted `automation` folder in a permanent location. Do not run it from a temporary ZIP preview and do not move it after installation.
- Have the same private 32+ character sync key that you already use for the management portal ready. It is saved once in the Windows helper and once in the Chrome extension; it is not requested for every sync.

## Install once

1. Extract `changes_files_only.zip` to a permanent folder on this Windows PC.
2. Open the extracted `automation` folder.
3. Right-click inside the folder and choose **Open in Terminal**, or open PowerShell there.
4. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-desktop-sync.ps1
```

5. Paste the private sync key when asked. The key is hidden while typing.
6. Chrome opens its Extensions page and File Explorer opens the supplied `chrome-extension` folder.
7. Turn on **Developer mode**. For a new install, click **Load unpacked** and select the `chrome-extension` folder. If it is already installed, click the extension's circular **Reload** button after replacing the files and confirm it shows version **1.1.0**.
8. The EUYFC extension options open automatically. Paste the same key, click **Save**, return to PowerShell and press Enter.
9. The installer builds the first approval report. Chrome opens the Full-Time tabs, visits every results and fixtures page, reads them and closes the tabs. The app is not changed yet.

The installer then creates two Windows Scheduled Tasks:

- **EUYFC Full-Time Sunday Sync** — scrapes every page every Sunday at 6:00 PM and saves a pending report for approval.
- **EUYFC Full-Time Portal Helper** — starts when this Windows user signs in and lets the management portal's manual button start the bot.

Keep the unpacked extension enabled. It has access only to `fulltime.thefa.com`, the local helper and Chrome tab/storage features. The first time the online management portal contacts the helper, Chrome may ask whether the site may access devices on the local network. Choose **Allow**. The helper listens only on this PC (`127.0.0.1`) and requires the private sync key.

## Normal use

- Automatic: leave the PC switched on (or asleep) and this Windows user signed in at 6:00 PM on Sunday. The task opens normal Chrome, captures every page and saves the report on this PC for seven days. It can wake the PC from sleep, but cannot run while it is shut down.
- Portal: use Chrome with the EUYFC extension enabled, then open **Management Portal → Results Uploader**. Choose **Load pending Sunday report**, or **Scrape & preview every page** for a fresh check. Review every Add, Change and Remove line, then choose **Approve & apply report**. Enter the key only the first time; it stays saved in that browser on this PC.
- Direct fallback: double-click `run-desktop-sync.cmd` to build the same pending report, then load and approve it in the management portal.
- Recheck browser access: double-click `setup-desktop-browser.cmd`.

Two background Chrome tabs open during a scrape, one after the other, and close after every available page has been read. Do not close them while it is running. If Full-Time displays a block page, repeats a page, fails to advance, exceeds the 50-page safety limit or contains an unrecognised league team, the bot stops approval and does not update match data.

## Server upload

Upload/extract the same changed-files ZIP into the app's existing server document root so the updated `management.html` and its `beta` copy are live. The Windows bot itself runs only on the PC; cPanel no longer needs Node.js, ScraperAPI or an FA scraping cron.

Disable the old cPanel Full-Time cron after installing this bot. The paste-and-preview result importer remains available as a manual fallback.

## Remove or reinstall the scheduled tasks

Run the installer again to refresh the tasks without replacing the saved key. To remove only the two scheduled tasks:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-desktop-sync.ps1 -RemoveTasks
```

This deliberately leaves `.desktop-sync-config.json` and the unpacked extension in place. The private configuration is ignored by Git and excluded from the changed-files ZIP.
