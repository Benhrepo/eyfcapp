<?php
// Copy this file to .cpanel-sync-config.php and replace the sync key below.
return [
    // Use a long private value. The management portal asks for it on manual sync.
    'sync_token' => 'replace-with-a-long-random-sync-key',

    // Required when FA Full-Time blocks the hosting IP. Create a free key at scraperapi.com.
    'scraperapi_key' => '',

    // These are optional. Leave blank to use the app's existing Firebase URL and public rules.
    'firebase_database_url' => '',
    'firebase_auth_token' => '',

    // Optional source URL overrides. Normally leave blank.
    'fulltime_results_url' => '',
    'fulltime_fixtures_url' => ''
];
