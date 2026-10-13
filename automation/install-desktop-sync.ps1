[CmdletBinding()]
param(
  [switch]$RemoveTasks,
  [switch]$SkipBrowserCheck
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$automationDirectory = $PSScriptRoot
$scheduledTaskName = "EUYFC Full-Time Sunday Sync"
$serviceTaskName = "EUYFC Full-Time Portal Helper"
$configPath = Join-Path $automationDirectory ".desktop-sync-config.json"

function Write-Step([string]$message) {
  Write-Host "`n==> $message" -ForegroundColor Cyan
}

function Find-Node {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Node.js was not found. Install the current Node.js LTS release from https://nodejs.org/ and run this installer again."
  }
  $versionText = (& $command.Source --version).Trim().TrimStart("v")
  try { $version = [version]$versionText } catch { throw "Could not read the installed Node.js version: $versionText" }
  if ($version -lt [version]"20.18.1") {
    throw "Node.js 20.18.1 or newer is required. Installed version: $versionText"
  }
  return $command.Source
}

function Find-Chrome {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  throw "Google Chrome or Microsoft Edge was not found. Install Chrome and run this installer again."
}

function Read-NewSyncKey {
  while ($true) {
    $secure = Read-Host "Paste the same private sync key used by the management portal (32+ characters)" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($plain.Length -ge 32) { return $plain }
    Write-Warning "The key must contain at least 32 characters. Nothing was saved; please try again."
  }
}

function Save-DesktopConfig([string]$syncKey) {
  $config = [ordered]@{
    syncToken = $syncKey
    chromePath = ""
    servicePort = 32187
    pageTimeoutSeconds = 120
    firebaseDatabaseUrl = ""
    firebaseAuthToken = ""
  }
  $json = $config | ConvertTo-Json
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($configPath, "$json`n", $utf8WithoutBom)

  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $configPath "/inheritance:r" "/grant:r" "${identity}:(F)" "*S-1-5-18:(F)" "*S-1-5-32-544:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls returned $LASTEXITCODE" }
  } catch {
    Write-Warning "The configuration was created, but Windows could not restrict its permissions automatically: $($_.Exception.Message)"
  }
}

if ($RemoveTasks) {
  Write-Step "Removing the two EUYFC scheduled tasks"
  foreach ($taskName in @($scheduledTaskName, $serviceTaskName)) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
      Write-Host "Removed: $taskName"
    }
  }
  Write-Host "The private configuration and Chrome extension files were left in place."
  exit 0
}

Write-Step "Checking Node.js"
$nodePath = Find-Node
Write-Host "Using $nodePath ($(& $nodePath --version))"

Write-Step "Installing the bot dependencies and running its tests"
Push-Location $automationDirectory
try {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw "The automated tests failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

if (Test-Path -LiteralPath $configPath) {
  Write-Step "Keeping the existing private desktop configuration"
  & $nodePath -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));" $configPath
  if ($LASTEXITCODE -ne 0) { throw "The existing .desktop-sync-config.json is not valid JSON." }
} else {
  Write-Step "Creating the private desktop configuration"
  Save-DesktopConfig (Read-NewSyncKey)
  Write-Host "Saved securely at $configPath"
}

Write-Step "Registering the Sunday sync and management-portal helper"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$existingServiceTask = Get-ScheduledTask -TaskName $serviceTaskName -ErrorAction SilentlyContinue
if ($existingServiceTask -and $existingServiceTask.State -eq "Running") {
  Stop-ScheduledTask -TaskName $serviceTaskName
  Start-Sleep -Seconds 1
}
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

$syncAction = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}" --scheduled' -f (Join-Path $automationDirectory "desktop-sync.mjs")) `
  -WorkingDirectory $automationDirectory
$syncTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Sunday -At "6:00 PM"
$syncTask = New-ScheduledTask -Action $syncAction -Trigger $syncTrigger -Principal $principal -Settings $settings `
  -Description "Checks every FA Full-Time page every Sunday at 18:00 and stages a report for management approval."
Register-ScheduledTask -TaskName $scheduledTaskName -InputObject $syncTask -Force | Out-Null

$serviceAction = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}"' -f (Join-Path $automationDirectory "desktop-sync-service.mjs")) `
  -WorkingDirectory $automationDirectory
$serviceTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$serviceSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
$serviceTask = New-ScheduledTask -Action $serviceAction -Trigger $serviceTrigger -Principal $principal -Settings $serviceSettings `
  -Description "Lets the EUYFC management portal start the local Windows Chrome sync bot."
Register-ScheduledTask -TaskName $serviceTaskName -InputObject $serviceTask -Force | Out-Null
Start-ScheduledTask -TaskName $serviceTaskName

Write-Step "Checking the local management-portal helper"
$ready = $false
for ($attempt = 1; $attempt -le 15; $attempt += 1) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:32187/health" -TimeoutSec 2
    if ($health.status -eq "ready") { $ready = $true; break }
  } catch {}
}
if (-not $ready) {
  throw "The tasks were installed, but the local helper did not answer. Start '$serviceTaskName' from Task Scheduler or run start-desktop-sync-service.cmd, then run this installer again."
} else {
  Write-Host "The management-portal helper is ready." -ForegroundColor Green
}

if (-not $SkipBrowserCheck) {
  Write-Step "Installing the EUYFC extension in normal Chrome"
  $browserPath = Find-Chrome
  $extensionDirectory = Join-Path $automationDirectory "chrome-extension"
  Start-Process explorer.exe -ArgumentList $extensionDirectory
  Start-Process $browserPath -ArgumentList "chrome://extensions/"
  Write-Host "1. Turn on Developer mode at the top-right of the Chrome extensions page."
  Write-Host "2. If EUYFC Full-Time Sync is already installed, click its circular Reload button. Otherwise click Load unpacked and select:"
  Write-Host "   $extensionDirectory" -ForegroundColor Yellow
  Write-Host "3. Confirm the extension shows version 1.1.0. For a new install, paste the same private sync key in its options and click Save."
  Read-Host "Press Enter after version 1.1.0 is loaded and the extension key is saved or retained"

  Write-Step "Building the first approval report through normal Chrome"
  Write-Host "Chrome will visit every public results and fixtures page, then save a report without changing the app."
  & $nodePath (Join-Path $automationDirectory "desktop-sync.mjs") --preview-only
  if ($LASTEXITCODE -ne 0) {
    throw "The first Chrome-extension report failed safely. No data was applied. Check the extension icon/message, then retry from the management portal."
  }
}

Write-Host "`nInstallation complete." -ForegroundColor Green
Write-Host "- Automatic scrape: Sundays at 6:00 PM while this Windows user is logged in; it waits for portal approval."
Write-Host "- Manual scrape and approval: use the management portal."
Write-Host "- Chrome must keep the unpacked EUYFC extension enabled."
Write-Host "- Keep this automation folder in its current location."
