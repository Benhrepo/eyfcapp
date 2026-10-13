<?php
declare(strict_types=1);

require_once __DIR__ . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . 'fulltime-sync.php';

$isCli = PHP_SAPI === 'cli';
if (!$isCli) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
}

function euyfc_respond(int $status, array $payload): void
{
    if (PHP_SAPI !== 'cli') {
        http_response_code($status);
    }
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit($status >= 400 ? 1 : 0);
}

function euyfc_request_header(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return trim((string)($_SERVER[$key] ?? ''));
}

$configPath = __DIR__ . DIRECTORY_SEPARATOR . '.cpanel-sync-config.php';
if (!is_file($configPath)) {
    euyfc_respond(503, [
        'status' => 'configuration-required',
        'message' => 'Create automation/.cpanel-sync-config.php from the supplied example before running the sync.'
    ]);
}

$config = require $configPath;
if (!is_array($config)) {
    euyfc_respond(500, ['status' => 'failed', 'message' => 'The cPanel sync configuration is invalid.']);
}

if (!$isCli) {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        euyfc_respond(405, ['status' => 'failed', 'message' => 'Use the Sync fixtures & results button in the management portal.']);
    }
    $expectedToken = trim((string)($config['sync_token'] ?? ''));
    $providedToken = euyfc_request_header('X-Sync-Token');
    if ($expectedToken === '' || $providedToken === '' || !hash_equals($expectedToken, $providedToken)) {
        euyfc_respond(401, ['status' => 'unauthorised', 'message' => 'The cPanel sync key is missing or incorrect.']);
    }
}

if ($isCli && in_array('--cron', $argv ?? [], true)) {
    $londonNow = new DateTimeImmutable('now', new DateTimeZone('Europe/London'));
    if ($londonNow->format('w') !== '0' || $londonNow->format('G') !== '18') {
        euyfc_respond(200, [
            'status' => ['skipped' => true],
            'message' => 'Schedule check skipped: it is ' . $londonNow->format('D H:i') . ' in Europe/London, not Sunday at 18:00.'
        ]);
    }
}

$lockHandle = fopen(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'euyfc-fulltime-sync.lock', 'c');
if ($lockHandle === false || !flock($lockHandle, LOCK_EX | LOCK_NB)) {
    euyfc_respond(409, ['status' => 'busy', 'message' => 'A fixtures and results sync is already running.']);
}

try {
    if (!$isCli && euyfc_config_value($config, 'github_token') !== '') {
        $status = euyfc_dispatch_github($config);
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
        euyfc_respond(202, ['status' => $status, 'message' => $status['message']]);
    }
    $status = euyfc_run_sync($config);
    flock($lockHandle, LOCK_UN);
    fclose($lockHandle);
    euyfc_respond(200, ['status' => $status, 'message' => (string)($status['message'] ?? 'Sync completed.')]);
} catch (Throwable $error) {
    flock($lockHandle, LOCK_UN);
    fclose($lockHandle);
    euyfc_respond(502, ['status' => 'failed', 'message' => $error->getMessage()]);
}
