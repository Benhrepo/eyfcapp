# Windows Chrome bot setup

This is the primary FA Full-Time sync method. A small unpacked extension opens the public results and fixtures pages inside your normal Chrome profile, reads the visible match data, and passes it to a private helper on this PC. The helper uses the same duplicate checks and safe merge code already used by the app.

The bot writes to the app's existing Firebase paths. One successful run therefore updates the management portal, public app, league table, other clubs' cup results and fixtures together.

Eastbourne's U13 Championship fixtures are updated in both the team schedule and shared league fixture list. Eastbourne results remain manual. Obsolete empty imported fixtures are reconciled after postponements, while completed games, cup games, custom fixtures and all matchday data are preserved.

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
7. Turn on **Developer mode**, click **Load unpacked**, and select the `chrome-extension` folder.
8. The EUYFC extension options open automatically. Paste the same key, click **Save**, return to PowerShell and press Enter.
9. The installer runs the first live sync. Chrome opens the two Full-Time tabs in your normal profile, reads them, and closes those tabs.

The installer then creates two Windows Scheduled Tasks:

- **EUYFC Full-Time Sunday Sync** — runs every Sunday at 6:00 PM.
- **EUYFC Full-Time Portal Helper** — starts when this Windows user signs in and lets the management portal's manual button start the bot.

Keep the unpacked extension enabled. It has access only to `fulltime.thefa.com`, the local helper and Chrome tab/storage features. The first time the online management portal contacts the helper, Chrome may ask whether the site may access devices on the local network. Choose **Allow**. The helper listens only on this PC (`127.0.0.1`) and requires the private sync key.

## Normal use

- Automatic: leave the PC switched on (or asleep) and this Windows user signed in at 6:00 PM on Sunday. The task opens normal Chrome so the extension can capture the pages. It can wake the PC from sleep, but cannot run while it is shut down.
- Portal: use Chrome with the EUYFC extension enabled, then open **Management Portal → Results Uploader → Run PC browser sync now**. Enter the key the first time; it is saved in that browser on this PC and removed automatically if the helper rejects it.
- Direct fallback: double-click `run-desktop-sync.cmd`.
- Recheck browser access: double-click `setup-desktop-browser.cmd`.

Two background Chrome tabs open during a sync and close after both pages have been read. Do not close them while the sync is running. If Full-Time displays a block page or the match rows are incomplete, the bot stops and does not update match data.

## Server upload

Upload/extract the same changed-files ZIP into the app's existing server document root so the updated `management.html` and its `beta` copy are live. The Windows bot itself runs only on the PC; cPanel no longer needs Node.js, ScraperAPI or an FA scraping cron.

Disable the old cPanel Full-Time cron after installing this bot. The paste-and-preview result importer remains available as a manual fallback.

## Remove or reinstall the scheduled tasks

Run the installer again to refresh the tasks without replacing the saved key. To remove only the two scheduled tasks:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-desktop-sync.ps1 -RemoveTasks
```

This deliberately leaves `.desktop-sync-config.json` and the unpacked extension in place. The private configuration is ignored by Git and excluded from the changed-files ZIP.
