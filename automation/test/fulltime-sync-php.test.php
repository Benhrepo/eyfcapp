<?php
declare(strict_types=1);

require_once dirname(__DIR__) . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . 'fulltime-sync.php';

function check(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$resultsHtml = (string)file_get_contents(__DIR__ . DIRECTORY_SEPARATOR . 'fixtures-results.html');
$parsed = euyfc_parse_results_html($resultsHtml);
check(count($parsed['all']) === 3, 'three results are parsed');
check(count($parsed['league']) === 1, 'one league result is included');
check(count($parsed['cups']) === 1, 'one cup result is included');
check(count($parsed['ignored']) === 1, 'the Eastbourne result is ignored');
check($parsed['league'][0]['homeTeam'] === 'Whitehawk U13 Whitehawk u13', 'league team name is normalised');
check($parsed['league'][0]['awayScore'] === 4, 'score is parsed');
check($parsed['league'][0]['fullTimeFixtureId'] === 'league-1', 'result fixture ID is parsed');
echo "PASS: results parsing and Eastbourne exclusion\n";

$fixturesHtml = (string)file_get_contents(__DIR__ . DIRECTORY_SEPARATOR . 'fixtures-list.html');
$fixtures = euyfc_parse_fixtures_html($fixturesHtml);
check(count($fixtures['all']) === 2, 'only Championship fixtures are parsed');
check(count($fixtures['ours']) === 1, 'one Eastbourne fixture is parsed');
check(count($fixtures['others']) === 1, 'one other league fixture is parsed');
check($fixtures['ours'][0]['fullTimeFixtureId'] === 'fixture-ours', 'fixture ID is parsed');
check($fixtures['others'][0]['venue'] === 'Training Ground', 'fixture venue is parsed');
echo "PASS: U13 Championship fixture filtering\n";

$current = [[
    'id' => 'stored', 'fullTimeFixtureId' => 'fixture-other', 'date' => '11/10/2026',
    'kickOffTime' => '11:00', 'homeTeam' => 'Brighton & Hove Albion Women FC U13',
    'awayTeam' => 'Saltdean United FC U13', 'competition' => 'League',
    'homeScore' => 2, 'awayScore' => 1, 'scoreText' => '2-1'
]];
$incoming = [[
    'id' => 'fa-fixture-fixture-other', 'fullTimeFixtureId' => 'fixture-other',
    'date' => '18/10/2026', 'kickOffTime' => '12:00',
    'homeTeam' => 'Brighton & Hove Albion Women FC U13', 'awayTeam' => 'Saltdean United FC U13',
    'competition' => 'League', 'homeScore' => -1, 'awayScore' => -1, 'scoreText' => 'TBC'
]];
$merged = euyfc_merge_match_list($current, $incoming, 'fixture');
check(count($merged['value']) === 1, 'fixture is updated rather than duplicated');
check($merged['value'][0]['date'] === '18/10/2026', 'changed fixture date is applied');
check($merged['value'][0]['homeScore'] === 2 && $merged['value'][0]['awayScore'] === 1, 'recorded score is preserved');
check($merged['stats']['updated'] === 1, 'fixture update is counted');
echo "PASS: duplicate matching and score preservation\n";

$team = ['fixtures' => [[
    'id' => 'our-stored', 'fullTimeFixtureId' => 'fixture-ours',
    'opponent' => 'Horley United U13 Emerald', 'date' => '11/10/2026',
    'kickOffTime' => '10:00', 'venue' => 'Home', 'competition' => 'League',
    'ourScore' => 6, 'opponentScore' => 2, 'completed' => true,
    'matchdayEvents' => [['type' => 'goal']], 'goalCounts' => ['p1' => 3], 'motmPlayerId' => 'p1'
]]];
$row = [[
    'id' => 'fa-fixture-fixture-ours', 'fullTimeFixtureId' => 'fixture-ours',
    'date' => '18/10/2026', 'kickOffTime' => '11:30', 'homeTeam' => EUYFC_CLUB,
    'awayTeam' => 'Horley United U13 Emerald', 'competition' => 'League', 'venue' => 'The Oval'
]];
$ourMerged = euyfc_merge_our_fixtures($team, $row);
$fixture = $ourMerged['value']['fixtures'][0];
check($fixture['id'] === 'our-stored', 'existing Eastbourne fixture ID is preserved');
check($fixture['date'] === '18/10/2026', 'Eastbourne fixture schedule is updated');
check($fixture['ourScore'] === 6 && count($fixture['matchdayEvents']) === 1, 'score and matchday events are preserved');
check($fixture['goalCounts']['p1'] === 3 && $fixture['motmPlayerId'] === 'p1', 'goals and MOTM are preserved');
echo "PASS: Eastbourne matchday data preservation\n";

echo "All 4 PHP sync tests passed.\n";
