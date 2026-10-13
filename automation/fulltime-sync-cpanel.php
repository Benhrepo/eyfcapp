<?php
declare(strict_types=1);

$isCli = PHP_SAPI === 'cli';
$euyfcResponded = false;
if (!$isCli) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    ob_start();
}

function euyfc_respond(int $status, array $payload): void
{
    global $euyfcResponded;
    $euyfcResponded = true;
    if (PHP_SAPI !== 'cli') {
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit($status >= 400 ? 1 : 0);
}

function euyfc_request_header(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return trim((string)($_SERVER[$key] ?? ''));
}

if (!$isCli) {
    register_shutdown_function(static function () use (&$euyfcResponded): void {
        if ($euyfcResponded) {
            return;
        }
        $error = error_get_last();
        $fatalTypes = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
        if ($error === null || !in_array($error['type'] ?? 0, $fatalTypes, true)) {
            return;
        }
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode([
            'status' => 'failed',
            'message' => 'The server stopped the sync: ' . trim((string)($error['message'] ?? 'unknown PHP error'))
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    });
}

// ScraperAPI may try several safe proxy/rendering modes for both Full-Time pages.
if (function_exists('set_time_limit')) {
    @set_time_limit(360);
}
if (function_exists('ignore_user_abort')) {
    @ignore_user_abort(true);
}

try {
    require_once __DIR__ . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . 'fulltime-sync.php';
} catch (Throwable $error) {
    euyfc_respond(500, [
        'status' => 'failed',
        'message' => 'The sync code could not start: ' . $error->getMessage()
    ]);
}

$configPath = __DIR__ . DIRECTORY_SEPARATOR . '.cpanel-sync-config.php';
if (!is_file($configPath)) {
    euyfc_respond(503, [
        'status' => 'configuration-required',
        'message' => 'Create automation/.cpanel-sync-config.php from the supplied example before running the sync.'
    ]);
}

try {
    $config = require $configPath;
} catch (Throwable $error) {
    euyfc_respond(500, [
        'status' => 'failed',
        'message' => 'The private cPanel configuration contains a PHP error near line ' . $error->getLine() . '. Run the documented php -l check on the file; no sync data was changed.'
    ]);
}
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
    $status = euyfc_run_sync($config);
    flock($lockHandle, LOCK_UN);
    fclose($lockHandle);
    euyfc_respond(200, ['status' => $status, 'message' => (string)($status['message'] ?? 'Sync completed.')]);
} catch (Throwable $error) {
    flock($lockHandle, LOCK_UN);
    fclose($lockHandle);
    euyfc_respond(502, ['status' => 'failed', 'message' => $error->getMessage()]);
}
