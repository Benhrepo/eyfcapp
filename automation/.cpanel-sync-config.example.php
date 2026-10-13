<?php
// Copy this file to .cpanel-sync-config.php and replace the sync key below.
return [
    // Use a long private value. The management portal asks for it on manual sync.
    'sync_token' => 'replace-with-a-long-random-sync-key',

    // Optional GitHub browser runner used when Full-Time blocks the cPanel IP.
    // Use a fine-grained token restricted to this repository with Actions: Read and write.
    'github_repository' => 'Benhrepo/eyfcapp',
    'github_workflow' => 'fulltime-sync.yml',
    'github_branch' => 'main',
    'github_token' => '',

    // These are optional. Leave blank to use the app's existing Firebase URL and public rules.
    'firebase_database_url' => '',
    'firebase_auth_token' => '',

    // Optional source URL overrides. Normally leave blank.
    'fulltime_results_url' => '',
    'fulltime_fixtures_url' => ''
];
