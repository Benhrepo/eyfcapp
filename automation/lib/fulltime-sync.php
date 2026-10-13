<?php
declare(strict_types=1);

const EUYFC_CLUB = 'Eastbourne United U13s';
const EUYFC_LEAGUE_NAME = 'Mid Sussex Youth Football League';
const EUYFC_DIVISION_NAME = 'U13 Championship';
const EUYFC_AUTOMATION_SOURCE = 'FA Full-Time Automatic Sync';
const EUYFC_DEFAULT_DATABASE_ROOT = 'https://eastbourneu13-default-rtdb.firebaseio.com/eastbourne-united-u13';
const EUYFC_RESULTS_URL = 'https://fulltime.thefa.com/results.html?selectedSeason=2616809&selectedFixtureGroupAgeGroup=0&selectedFixtureGroupKey=1_516568481&selectedRelatedFixtureOption=3&selectedClub=&selectedTeam=&selectedDateCode=all&previousSelectedFixtureGroupAgeGroup=&previousSelectedFixtureGroupKey=&previousSelectedClub=&itemsPerPage=10000';
const EUYFC_FIXTURES_URL = 'https://fulltime.thefa.com/fixtures.html?league=1375655&selectedSeason=2616809&selectedDivision=655442940&selectedCompetition=0&selectedFixtureGroupKey=1_516568481&selectedDateCode=all&selectedRelatedFixtureOption=1&itemsPerPage=10000';

function euyfc_official_teams(): array
{
    return [
        'ASC Brighton Rangers U13',
        'Brighton & Hove Albion Women FC U13',
        EUYFC_CLUB,
        'Horley United U13 Emerald',
        'Patcham United U13 Black',
        'Saltdean United FC U13',
        'Southwick U13 Black',
        'Whitehawk U13 Whitehawk u13'
    ];
}

function euyfc_clean($value): string
{
    $text = html_entity_decode((string)($value ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = str_replace(["\u{2013}", "\u{2014}", "\u{00A0}"], ['-', '-', ' '], $text);
    return trim((string)preg_replace('/\s+/u', ' ', $text));
}

function euyfc_team_key($value): string
{
    $text = strtolower(euyfc_clean($value));
    $text = str_replace('&', ' and ', $text);
    $text = (string)preg_replace('/\bu\s*13s?\b/i', ' ', $text);
    $text = (string)preg_replace('/\bunder\s*13s?\b/i', ' ', $text);
    $text = (string)preg_replace('/\bfootball club\b|\bfc\b/i', ' ', $text);
    $text = (string)preg_replace('/[^a-z0-9]+/', ' ', $text);
    return trim((string)preg_replace('/\s+/', ' ', $text));
}

function euyfc_known_team($value): string
{
    static $byKey = null;
    if ($byKey === null) {
        $byKey = [];
        foreach (euyfc_official_teams() as $team) {
            $byKey[euyfc_team_key($team)] = $team;
        }
        foreach ([
            'Eastbourne United Association Youth U13',
            'Eastbourne United Association Youth U13s',
            'Eastbourne United U13'
        ] as $alias) {
            $byKey[euyfc_team_key($alias)] = EUYFC_CLUB;
        }
    }
    return $byKey[euyfc_team_key($value)] ?? '';
}

function euyfc_is_eastbourne($value): bool
{
    return euyfc_known_team($value) === EUYFC_CLUB || preg_match('/eastbourne\s+united.*u\s*13/i', euyfc_clean($value)) === 1;
}

function euyfc_same_team($left, $right): bool
{
    $leftKey = euyfc_team_key($left);
    return $leftKey !== '' && $leftKey === euyfc_team_key($right);
}

function euyfc_parse_datetime($value): array
{
    $text = euyfc_clean($value);
    if (!preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}:\d{2}))?/', $text, $match)) {
        return ['date' => $text !== '' ? $text : 'TBC', 'time' => ''];
    }
    $year = strlen($match[3]) === 2 ? '20' . $match[3] : $match[3];
    return [
        'date' => sprintf('%02d/%02d/%s', (int)$match[1], (int)$match[2], $year),
        'time' => $match[4] ?? ''
    ];
}

function euyfc_date_number($value): float
{
    if (!preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/', euyfc_clean($value), $match)) {
        return INF;
    }
    return (float)gmmktime(0, 0, 0, (int)$match[2], (int)$match[1], (int)$match[3]);
}

function euyfc_stable_id(string $prefix, array $parts): string
{
    return $prefix . '-' . substr(hash('sha256', implode('|', array_map('euyfc_clean', $parts))), 0, 20);
}

function euyfc_dom(string $html): array
{
    if (!class_exists('DOMDocument') || !class_exists('DOMXPath')) {
        throw new RuntimeException('The PHP DOM extension is not enabled on this hosting account. Ask the host to enable PHP DOM/XML.');
    }
    $previous = libxml_use_internal_errors(true);
    $dom = new DOMDocument();
    $loaded = $dom->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    if (!$loaded) {
        throw new RuntimeException('FA Full-Time returned HTML that could not be read. No app data was changed.');
    }
    return [$dom, new DOMXPath($dom)];
}

function euyfc_class_xpath(string $class): string
{
    return "contains(concat(' ', normalize-space(@class), ' '), ' {$class} ')";
}

function euyfc_nodes(DOMXPath $xpath, string $query, ?DOMNode $context = null): array
{
    $list = $xpath->query($query, $context);
    if ($list === false) {
        return [];
    }
    $result = [];
    foreach ($list as $node) {
        $result[] = $node;
    }
    return $result;
}

function euyfc_first_class_text(DOMXPath $xpath, DOMNode $context, string $class): string
{
    $nodes = euyfc_nodes($xpath, './/*[' . euyfc_class_xpath($class) . ']', $context);
    return $nodes ? euyfc_clean($nodes[0]->textContent) : '';
}

function euyfc_fixture_id(DOMXPath $xpath, DOMNode $context): string
{
    $link = null;
    if ($context instanceof DOMElement && strtolower($context->tagName) === 'a' && strpos($context->getAttribute('href'), 'displayFixture.html') !== false) {
        $link = $context;
    } else {
        $nodes = euyfc_nodes($xpath, './/a[contains(@href, "displayFixture.html")]', $context);
        $link = $nodes[0] ?? null;
    }
    if (!($link instanceof DOMElement)) {
        return '';
    }
    $href = $link->getAttribute('href');
    $query = (string)(parse_url($href, PHP_URL_QUERY) ?? '');
    parse_str($query, $parameters);
    return euyfc_clean($parameters['id'] ?? '');
}

function euyfc_score($value): ?array
{
    if (!preg_match('/(\d+)\s*-\s*(\d+)/', euyfc_clean($value), $match)) {
        return null;
    }
    return ['homeScore' => (int)$match[1], 'awayScore' => (int)$match[2], 'scoreText' => $match[1] . '-' . $match[2]];
}

function euyfc_result_record(array $input): ?array
{
    $date = euyfc_parse_datetime($input['dateTime'] ?? '');
    $score = euyfc_score($input['scoreText'] ?? '');
    $homeTeam = euyfc_clean($input['homeTeam'] ?? '');
    $awayTeam = euyfc_clean($input['awayTeam'] ?? '');
    if ($score === null || $homeTeam === '' || $awayTeam === '') {
        return null;
    }
    $rawCompetition = euyfc_clean($input['competition'] ?? '');
    $league = strtolower($rawCompetition) === strtolower(EUYFC_DIVISION_NAME);
    $officialHome = $league ? euyfc_known_team($homeTeam) : $homeTeam;
    $officialAway = $league ? euyfc_known_team($awayTeam) : $awayTeam;
    if ($league && ($officialHome === '' || $officialAway === '')) {
        return ['rejected' => 'unknown-league-team', 'homeTeam' => $homeTeam, 'awayTeam' => $awayTeam];
    }
    $normalizedHome = euyfc_is_eastbourne($homeTeam) ? EUYFC_CLUB : $officialHome;
    $normalizedAway = euyfc_is_eastbourne($awayTeam) ? EUYFC_CLUB : $officialAway;
    $fixtureId = euyfc_clean($input['fullTimeFixtureId'] ?? '');
    $id = $fixtureId !== ''
        ? 'fa-result-' . $fixtureId
        : euyfc_stable_id('fa-result', [$date['date'], $normalizedHome, $normalizedAway, $rawCompetition]);
    return array_merge([
        'id' => $id,
        'fullTimeFixtureId' => $fixtureId,
        'date' => $date['date'],
        'kickOffTime' => $date['time'],
        'homeTeam' => $normalizedHome,
        'awayTeam' => $normalizedAway,
        'competition' => $league ? 'League' : ($rawCompetition !== '' ? $rawCompetition : 'Cup')
    ], $score, [
        'leagueName' => EUYFC_LEAGUE_NAME,
        'divisionName' => $rawCompetition,
        'notes' => euyfc_clean($input['notes'] ?? ''),
        'venue' => '',
        'source' => EUYFC_AUTOMATION_SOURCE,
        'ignored' => euyfc_is_eastbourne($normalizedHome) || euyfc_is_eastbourne($normalizedAway),
        'importBucket' => $league ? 'league' : 'cup'
    ]);
}

function euyfc_result_container(DOMXPath $xpath, DOMNode $dateNode): ?DOMNode
{
    $candidate = $dateNode;
    for ($depth = 0; $depth < 9 && $candidate !== null; $depth++) {
        $home = euyfc_nodes($xpath, './/*[' . euyfc_class_xpath('home-team-col') . ']', $candidate);
        $away = euyfc_nodes($xpath, './/*[' . euyfc_class_xpath('road-team-col') . ']', $candidate);
        $score = euyfc_nodes($xpath, './/*[' . euyfc_class_xpath('score-col') . ']', $candidate);
        if ($home && $away && $score) {
            return $candidate;
        }
        $candidate = $candidate->parentNode;
    }
    return null;
}

function euyfc_add_result(array &$records, array &$rejected, array &$seen, ?array $record): void
{
    if ($record === null) {
        return;
    }
    if (isset($record['rejected'])) {
        $rejected[] = $record;
        return;
    }
    $key = implode('|', [
        $record['fullTimeFixtureId'], $record['date'], euyfc_team_key($record['homeTeam']),
        euyfc_team_key($record['awayTeam']), $record['homeScore'], $record['awayScore']
    ]);
    if (!isset($seen[$key])) {
        $seen[$key] = true;
        $records[] = $record;
    }
}

function euyfc_parse_results_html(string $html): array
{
    [, $xpath] = euyfc_dom($html);
    $records = [];
    $rejected = [];
    $seen = [];
    foreach (euyfc_nodes($xpath, '//*[' . euyfc_class_xpath('datetime-col') . ']') as $dateNode) {
        $row = euyfc_result_container($xpath, $dateNode);
        if ($row === null) {
            continue;
        }
        $notes = [];
        foreach (euyfc_nodes($xpath, './/*[self::div or self::span or self::td]', $row) as $noteNode) {
            $value = euyfc_clean($noteNode->textContent);
            if (preg_match('/^\(.*\)$/', $value) && !in_array($value, $notes, true)) {
                $notes[] = $value;
            }
        }
        euyfc_add_result($records, $rejected, $seen, euyfc_result_record([
            'dateTime' => euyfc_first_class_text($xpath, $row, 'datetime-col'),
            'homeTeam' => euyfc_first_class_text($xpath, $row, 'home-team-col'),
            'awayTeam' => euyfc_first_class_text($xpath, $row, 'road-team-col'),
            'scoreText' => euyfc_first_class_text($xpath, $row, 'score-col'),
            'competition' => euyfc_first_class_text($xpath, $row, 'fg-col'),
            'notes' => implode(' | ', $notes),
            'fullTimeFixtureId' => euyfc_fixture_id($xpath, $row)
        ]));
    }
    if (!$records) {
        foreach (euyfc_nodes($xpath, '//table//tr') as $row) {
            $cells = array_map(static fn(DOMNode $cell): string => euyfc_clean($cell->textContent), euyfc_nodes($xpath, './/td', $row));
            $dateIndex = -1;
            $scoreIndex = -1;
            foreach ($cells as $index => $cell) {
                if ($dateIndex < 0 && preg_match('/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}/', $cell)) {
                    $dateIndex = $index;
                }
                if ($scoreIndex < 0 && preg_match('/\d+\s*-\s*\d+/', $cell)) {
                    $scoreIndex = $index;
                }
            }
            if ($dateIndex < 0 || $scoreIndex < 0) {
                continue;
            }
            $home = '';
            foreach (array_slice($cells, $dateIndex + 1, $scoreIndex - $dateIndex - 1) as $value) {
                if ($value !== '') { $home = $value; break; }
            }
            $away = '';
            foreach (array_slice($cells, $scoreIndex + 1) as $value) {
                if ($value !== '' && !preg_match('/^\(.*\)$/', $value)) { $away = $value; break; }
            }
            $competition = '';
            foreach (array_reverse($cells) as $value) {
                if (preg_match('/championship|cup|trophy/i', $value)) { $competition = $value; break; }
            }
            $notes = array_values(array_filter($cells, static fn(string $value): bool => preg_match('/^\(.*\)$/', $value) === 1));
            euyfc_add_result($records, $rejected, $seen, euyfc_result_record([
                'dateTime' => $cells[$dateIndex], 'homeTeam' => $home, 'awayTeam' => $away,
                'scoreText' => $cells[$scoreIndex], 'competition' => $competition,
                'notes' => implode(' | ', $notes), 'fullTimeFixtureId' => euyfc_fixture_id($xpath, $row)
            ]));
        }
    }
    $ignored = array_values(array_filter($records, static fn(array $row): bool => !empty($row['ignored'])));
    return [
        'all' => $records,
        'league' => array_values(array_filter($records, static fn(array $row): bool => empty($row['ignored']) && $row['importBucket'] === 'league')),
        'cups' => array_values(array_filter($records, static fn(array $row): bool => empty($row['ignored']) && $row['importBucket'] === 'cup')),
        'ignored' => $ignored,
        'rejected' => $rejected
    ];
}

function euyfc_fixture_record(array $input): ?array
{
    if (strtolower(euyfc_clean($input['competition'] ?? '')) !== strtolower(EUYFC_DIVISION_NAME)) {
        return null;
    }
    $home = euyfc_known_team($input['homeTeam'] ?? '');
    $away = euyfc_known_team($input['awayTeam'] ?? '');
    if ($home === '' || $away === '') {
        return ['rejected' => 'unknown-league-team', 'homeTeam' => euyfc_clean($input['homeTeam'] ?? ''), 'awayTeam' => euyfc_clean($input['awayTeam'] ?? '')];
    }
    $date = euyfc_parse_datetime($input['dateTime'] ?? '');
    $fixtureId = euyfc_clean($input['fullTimeFixtureId'] ?? '');
    return [
        'id' => $fixtureId !== '' ? 'fa-fixture-' . $fixtureId : euyfc_stable_id('fa-fixture', [$date['date'], $home, $away]),
        'fullTimeFixtureId' => $fixtureId,
        'date' => $date['date'],
        'kickOffTime' => $date['time'],
        'homeTeam' => $home,
        'awayTeam' => $away,
        'competition' => 'League',
        'homeScore' => -1,
        'awayScore' => -1,
        'scoreText' => 'TBC',
        'leagueName' => EUYFC_LEAGUE_NAME,
        'divisionName' => EUYFC_DIVISION_NAME,
        'notes' => '',
        'venue' => euyfc_clean($input['venue'] ?? ''),
        'source' => EUYFC_AUTOMATION_SOURCE
    ];
}

function euyfc_parse_fixtures_html(string $html): array
{
    [, $xpath] = euyfc_dom($html);
    $records = [];
    $rejected = [];
    $seen = [];
    foreach (euyfc_nodes($xpath, '//table//tr') as $row) {
        $cells = array_map(static fn(DOMNode $cell): string => euyfc_clean($cell->textContent), euyfc_nodes($xpath, './/td', $row));
        if (count($cells) < 7) {
            continue;
        }
        $dateIndex = -1;
        $vsIndex = -1;
        foreach ($cells as $index => $cell) {
            if ($dateIndex < 0 && ($cell === 'TBC' || preg_match('/^\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2})?/', $cell))) {
                $dateIndex = $index;
            }
            if ($vsIndex < 0 && strtolower($cell) === 'vs') {
                $vsIndex = $index;
            }
        }
        if ($dateIndex < 0 || $vsIndex < 0) {
            continue;
        }
        $home = '';
        foreach (array_slice($cells, $dateIndex + 1, $vsIndex - $dateIndex - 1) as $value) {
            if ($value !== '') { $home = $value; break; }
        }
        $competitionIndex = -1;
        foreach ($cells as $index => $value) {
            if ($index > $vsIndex && strtolower($value) === strtolower(EUYFC_DIVISION_NAME)) { $competitionIndex = $index; break; }
        }
        if ($competitionIndex < 0) {
            continue;
        }
        $away = '';
        foreach (array_slice($cells, $vsIndex + 1, $competitionIndex - $vsIndex - 1) as $value) {
            if (euyfc_known_team($value) !== '') { $away = $value; break; }
        }
        if ($away === '') {
            foreach (array_slice($cells, $vsIndex + 1, $competitionIndex - $vsIndex - 1) as $value) {
                if ($value !== '') { $away = $value; break; }
            }
        }
        $awayIndex = -1;
        foreach ($cells as $index => $value) {
            if ($index > $vsIndex && $value === $away) { $awayIndex = $index; break; }
        }
        $venue = '';
        if ($awayIndex >= 0) {
            foreach (array_slice($cells, $awayIndex + 1, $competitionIndex - $awayIndex - 1) as $value) {
                if ($value !== '') { $venue = $value; break; }
            }
        }
        $record = euyfc_fixture_record([
            'dateTime' => $cells[$dateIndex], 'homeTeam' => $home, 'awayTeam' => $away,
            'venue' => $venue, 'competition' => $cells[$competitionIndex],
            'fullTimeFixtureId' => euyfc_fixture_id($xpath, $row)
        ]);
        if ($record === null) {
            continue;
        }
        if (isset($record['rejected'])) {
            $rejected[] = $record;
            continue;
        }
        $key = $record['fullTimeFixtureId'] !== '' ? $record['fullTimeFixtureId'] : implode('|', [$record['date'], euyfc_team_key($record['homeTeam']), euyfc_team_key($record['awayTeam'])]);
        if (!isset($seen[$key])) {
            $seen[$key] = true;
            $records[] = $record;
        }
    }
    return [
        'all' => $records,
        'ours' => array_values(array_filter($records, static fn(array $row): bool => euyfc_is_eastbourne($row['homeTeam']) || euyfc_is_eastbourne($row['awayTeam']))),
        'others' => array_values(array_filter($records, static fn(array $row): bool => !euyfc_is_eastbourne($row['homeTeam']) && !euyfc_is_eastbourne($row['awayTeam']))),
        'rejected' => $rejected
    ];
}

function euyfc_unordered_pair(array $row): string
{
    $teams = [euyfc_team_key($row['homeTeam'] ?? ''), euyfc_team_key($row['awayTeam'] ?? '')];
    sort($teams, SORT_STRING);
    return implode('|', $teams);
}

function euyfc_ordered_pair(array $row): string
{
    return euyfc_team_key($row['homeTeam'] ?? '') . '|' . euyfc_team_key($row['awayTeam'] ?? '');
}

function euyfc_changed($before, $after): bool
{
    return json_encode($before, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) !== json_encode($after, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function euyfc_find_list_match(array $list, array $row, string $mode): int
{
    if (!empty($row['fullTimeFixtureId'])) {
        foreach ($list as $index => $item) {
            if ((string)($item['fullTimeFixtureId'] ?? '') === (string)$row['fullTimeFixtureId']) { return $index; }
        }
    }
    foreach ($list as $index => $item) {
        if (euyfc_clean($item['date'] ?? '') === euyfc_clean($row['date'] ?? '') && euyfc_unordered_pair($item) === euyfc_unordered_pair($row)) { return $index; }
    }
    $rowDate = euyfc_date_number($row['date'] ?? '');
    if (!is_finite($rowDate)) {
        return -1;
    }
    $candidates = [];
    foreach ($list as $index => $item) {
        $itemDate = euyfc_date_number($item['date'] ?? '');
        $distance = abs($itemDate - $rowDate);
        if (!is_finite($distance)) { continue; }
        $samePair = $mode === 'result' ? euyfc_unordered_pair($item) === euyfc_unordered_pair($row) : euyfc_ordered_pair($item) === euyfc_ordered_pair($row);
        $within = $mode === 'result' ? $distance <= 3 * 86400 : $distance <= 120 * 86400;
        $unscored = $mode === 'result' || ((int)($item['homeScore'] ?? -1) < 0 && (int)($item['awayScore'] ?? -1) < 0);
        if ($samePair && $within && $unscored) { $candidates[] = ['index' => $index, 'distance' => $distance]; }
    }
    usort($candidates, static fn(array $left, array $right): int => $left['distance'] <=> $right['distance']);
    return $candidates ? (int)$candidates[0]['index'] : -1;
}

function euyfc_action_stats(): array
{
    return ['added' => 0, 'updated' => 0, 'unchanged' => 0];
}

function euyfc_merge_match_list($current, array $rows, string $mode): array
{
    $list = is_array($current) ? array_values($current) : [];
    $stats = euyfc_action_stats();
    foreach ($rows as $row) {
        $index = euyfc_find_list_match($list, $row, $mode);
        if ($index < 0) {
            $list[] = $row;
            $stats['added']++;
            continue;
        }
        $existing = $list[$index];
        $scores = [];
        if ($mode === 'fixture' && (int)($existing['homeScore'] ?? -1) >= 0 && (int)($existing['awayScore'] ?? -1) >= 0) {
            $scores = [
                'homeScore' => (int)$existing['homeScore'],
                'awayScore' => (int)$existing['awayScore'],
                'scoreText' => $existing['scoreText'] ?? ($existing['homeScore'] . '-' . $existing['awayScore'])
            ];
        }
        $next = array_merge($existing, $row, $scores, [
            'id' => $existing['id'] ?? $row['id'],
            'fullTimeFixtureId' => $row['fullTimeFixtureId'] ?? ($existing['fullTimeFixtureId'] ?? ''),
            'source' => EUYFC_AUTOMATION_SOURCE
        ]);
        if (euyfc_changed($existing, $next)) {
            $list[$index] = $next;
            $stats['updated']++;
        } else {
            $stats['unchanged']++;
        }
    }
    usort($list, static function (array $left, array $right): int {
        $date = euyfc_date_number($left['date'] ?? '') <=> euyfc_date_number($right['date'] ?? '');
        return $date !== 0 ? $date : strcmp(euyfc_clean($left['kickOffTime'] ?? ''), euyfc_clean($right['kickOffTime'] ?? ''));
    });
    return ['value' => $list, 'stats' => $stats];
}

function euyfc_stored_fixture_match(array $fixture): array
{
    $away = ($fixture['venue'] ?? '') === 'Away';
    return [
        'date' => $fixture['date'] ?? '',
        'homeTeam' => $away ? ($fixture['opponent'] ?? '') : EUYFC_CLUB,
        'awayTeam' => $away ? EUYFC_CLUB : ($fixture['opponent'] ?? '')
    ];
}

function euyfc_find_our_fixture(array $fixtures, array $row): int
{
    if (!empty($row['fullTimeFixtureId'])) {
        foreach ($fixtures as $index => $item) {
            if ((string)($item['fullTimeFixtureId'] ?? '') === (string)$row['fullTimeFixtureId']) { return $index; }
        }
    }
    foreach ($fixtures as $index => $item) {
        if (euyfc_clean($item['date'] ?? '') === euyfc_clean($row['date'] ?? '') && euyfc_unordered_pair(euyfc_stored_fixture_match($item)) === euyfc_unordered_pair($row)) { return $index; }
    }
    $home = euyfc_is_eastbourne($row['homeTeam'] ?? '');
    $opponent = $home ? ($row['awayTeam'] ?? '') : ($row['homeTeam'] ?? '');
    $venue = $home ? 'Home' : 'Away';
    $rowDate = euyfc_date_number($row['date'] ?? '');
    $candidates = [];
    foreach ($fixtures as $index => $item) {
        $distance = abs(euyfc_date_number($item['date'] ?? '') - $rowDate);
        $valid = is_finite($distance) && $distance <= 120 * 86400
            && euyfc_same_team($item['opponent'] ?? '', $opponent)
            && ($item['venue'] ?? '') === $venue
            && euyfc_clean($item['competition'] ?? 'League') === 'League'
            && empty($item['completed'])
            && (int)($item['ourScore'] ?? -1) < 0
            && (int)($item['opponentScore'] ?? -1) < 0;
        if ($valid) { $candidates[] = ['index' => $index, 'distance' => $distance]; }
    }
    usort($candidates, static fn(array $left, array $right): int => $left['distance'] <=> $right['distance']);
    return $candidates ? (int)$candidates[0]['index'] : -1;
}

function euyfc_our_fixture(array $row, ?array $existing = null): array
{
    $home = euyfc_is_eastbourne($row['homeTeam'] ?? '');
    $schedule = [
        'id' => $existing['id'] ?? $row['id'],
        'fullTimeFixtureId' => $row['fullTimeFixtureId'] ?? ($existing['fullTimeFixtureId'] ?? ''),
        'opponent' => $home ? $row['awayTeam'] : $row['homeTeam'],
        'date' => $row['date'],
        'kickOffTime' => !empty($row['kickOffTime']) ? $row['kickOffTime'] : '10:00',
        'venue' => $home ? 'Home' : 'Away',
        'competition' => 'League',
        'venueName' => !empty($row['venue']) ? $row['venue'] : ($existing['venueName'] ?? ''),
        'source' => EUYFC_AUTOMATION_SOURCE
    ];
    if ($existing !== null) {
        return array_merge($existing, $schedule);
    }
    return array_merge($schedule, [
        'ourScore' => -1, 'opponentScore' => -1, 'completed' => false,
        'playerIds' => [], 'squadOrder' => [], 'illnessPlayerIds' => [],
        'formationShape' => '3-3-2', 'lineupPositions' => [], 'goalCounts' => [],
        'assistCounts' => [], 'goalScorers' => [], 'motmPlayerId' => '',
        'matchReport' => '', 'matchPhotos' => [], 'matchdayEvents' => [],
        'matchdayStatus' => '', 'unassignedGoals' => 0
    ]);
}

function euyfc_merge_our_fixtures($team, array $rows): array
{
    $nextTeam = is_array($team) ? $team : [];
    $fixtures = isset($nextTeam['fixtures']) && is_array($nextTeam['fixtures']) ? array_values($nextTeam['fixtures']) : [];
    $stats = euyfc_action_stats();
    foreach ($rows as $row) {
        $index = euyfc_find_our_fixture($fixtures, $row);
        if ($index < 0) {
            $fixtures[] = euyfc_our_fixture($row);
            $stats['added']++;
            continue;
        }
        $merged = euyfc_our_fixture($row, $fixtures[$index]);
        if (euyfc_changed($fixtures[$index], $merged)) {
            $fixtures[$index] = $merged;
            $stats['updated']++;
        } else {
            $stats['unchanged']++;
        }
    }
    usort($fixtures, static function (array $left, array $right): int {
        $date = euyfc_date_number($left['date'] ?? '') <=> euyfc_date_number($right['date'] ?? '');
        return $date !== 0 ? $date : strcmp(euyfc_clean($left['kickOffTime'] ?? ''), euyfc_clean($right['kickOffTime'] ?? ''));
    });
    foreach ($fixtures as $index => &$fixture) { $fixture['fixtureOrder'] = $index; }
    unset($fixture);
    $nextTeam['fixtures'] = $fixtures;
    return ['value' => $nextTeam, 'stats' => $stats];
}

function euyfc_http_request(string $method, string $url, array $headers = [], ?string $body = null, bool $follow = true): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('The PHP cURL extension is not enabled on this hosting account. Ask the host to enable PHP cURL.');
    }
    $responseHeaders = [];
    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_FOLLOWLOCATION => $follow,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$responseHeaders): int {
            $length = strlen($line);
            $colon = strpos($line, ':');
            if ($colon !== false) {
                $responseHeaders[strtolower(trim(substr($line, 0, $colon)))] = trim(substr($line, $colon + 1));
            }
            return $length;
        }
    ]);
    if ($body !== null) {
        curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
    }
    $responseBody = curl_exec($handle);
    if ($responseBody === false) {
        $message = curl_error($handle);
        throw new RuntimeException('Network request failed: ' . $message);
    }
    $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    return ['status' => $status, 'headers' => $responseHeaders, 'body' => (string)$responseBody];
}

function euyfc_fetch_fulltime(string $url): string
{
    $response = euyfc_http_request('GET', $url, [
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language: en-GB,en;q=0.9',
        'Accept-Encoding: identity',
        'Upgrade-Insecure-Requests: 1'
    ]);
    $body = $response['body'];
    if ($response['status'] === 403 && preg_match('/cloudflare|attention required|you have been blocked|you have been prevented/i', $body)) {
        throw new RuntimeException('FA Full-Time blocked this server through its Cloudflare protection. No app data was changed.');
    }
    if ($response['status'] !== 200) {
        throw new RuntimeException('FA Full-Time returned HTTP ' . ($response['status'] ?: 'unknown') . '. No app data was changed.');
    }
    if (preg_match('/attention required|you have been blocked|you have been prevented/i', $body)) {
        throw new RuntimeException('FA Full-Time blocked this server through its Cloudflare protection. No app data was changed.');
    }
    if (strlen($body) < 1000) {
        throw new RuntimeException('FA Full-Time returned an unexpectedly empty page. No app data was changed.');
    }
    return $body;
}

function euyfc_config_value(array $config, string $key, string $environment = ''): string
{
    $value = euyfc_clean($config[$key] ?? '');
    if ($value === '' && $environment !== '') {
        $fromEnvironment = getenv($environment);
        $value = $fromEnvironment === false ? '' : euyfc_clean($fromEnvironment);
    }
    return $value;
}

function euyfc_auth_url(string $url, array $config): string
{
    $token = euyfc_config_value($config, 'firebase_auth_token', 'FIREBASE_AUTH_TOKEN');
    if ($token === '') { return $url; }
    return $url . (strpos($url, '?') === false ? '?' : '&') . 'auth=' . rawurlencode($token);
}

function euyfc_database_url(string $path, array $config): string
{
    $root = euyfc_config_value($config, 'firebase_database_url', 'FIREBASE_DATABASE_URL');
    if ($root === '') { $root = EUYFC_DEFAULT_DATABASE_ROOT; }
    return euyfc_auth_url(rtrim($root, '/') . '/' . $path . '.json', $config);
}

function euyfc_dispatch_github(array $config): array
{
    $repository = euyfc_config_value($config, 'github_repository');
    $workflow = euyfc_config_value($config, 'github_workflow');
    $branch = euyfc_config_value($config, 'github_branch');
    $token = euyfc_config_value($config, 'github_token');
    if ($repository === '' || $workflow === '' || $token === '') {
        throw new RuntimeException('GitHub browser sync is not configured. Add github_repository, github_workflow and github_token to the private cPanel configuration.');
    }
    if ($branch === '') { $branch = 'main'; }
    $url = 'https://api.github.com/repos/' . $repository . '/actions/workflows/' . rawurlencode($workflow) . '/dispatches';
    $body = json_encode(['ref' => $branch], JSON_UNESCAPED_SLASHES);
    $response = euyfc_http_request('POST', $url, [
        'Accept: application/vnd.github+json',
        'Authorization: Bearer ' . $token,
        'X-GitHub-Api-Version: 2022-11-28',
        'Content-Type: application/json'
    ], $body, false);
    if ($response['status'] !== 204) {
        $details = json_decode($response['body'], true);
        $message = is_array($details) && !empty($details['message']) ? (string)$details['message'] : 'HTTP ' . $response['status'];
        throw new RuntimeException('GitHub could not start the browser sync: ' . $message);
    }
    $queued = [
        'status' => 'queued',
        'source' => EUYFC_AUTOMATION_SOURCE,
        'schedule' => 'Every Sunday at 18:00 Europe/London',
        'lastAttemptAt' => euyfc_iso_now(),
        'message' => 'GitHub browser sync queued. Results will appear here when the run finishes.'
    ];
    try { euyfc_firebase_put('fulltime_sync_status', $queued, $config); } catch (Throwable $ignored) {}
    return $queued;
}

function euyfc_firebase_get(string $path, array $config): array
{
    $response = euyfc_http_request('GET', euyfc_database_url($path, $config), ['X-Firebase-ETag: true', 'Cache-Control: no-cache']);
    if ($response['status'] !== 200) {
        throw new RuntimeException("Firebase GET {$path} failed with HTTP {$response['status']}");
    }
    return ['value' => json_decode($response['body'], true), 'etag' => $response['headers']['etag'] ?? ''];
}

function euyfc_firebase_put(string $path, $value, array $config, string $etag = ''): array
{
    $headers = ['Content-Type: application/json'];
    if ($etag !== '') { $headers[] = 'If-Match: ' . $etag; }
    $encoded = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($encoded === false) { throw new RuntimeException("Firebase PUT {$path} could not encode its data"); }
    $response = euyfc_http_request('PUT', euyfc_database_url($path, $config), $headers, $encoded, false);
    if ($response['status'] === 412) { return ['conflict' => true]; }
    if ($response['status'] < 200 || $response['status'] >= 300) {
        throw new RuntimeException("Firebase PUT {$path} failed with HTTP {$response['status']}");
    }
    return ['conflict' => false, 'value' => json_decode($response['body'], true)];
}

function euyfc_update_path(string $path, callable $merge, array $config, int $retries = 5): array
{
    $dryRun = !empty($config['dry_run']);
    for ($attempt = 1; $attempt <= $retries; $attempt++) {
        $current = euyfc_firebase_get($path, $config);
        $merged = $merge($current['value']);
        $modified = euyfc_changed($current['value'], $merged['value']);
        if ($dryRun || !$modified) { return array_merge($merged, ['modified' => $modified, 'written' => false]); }
        $write = euyfc_firebase_put($path, $merged['value'], $config, $current['etag']);
        if (empty($write['conflict'])) { return array_merge($merged, ['modified' => $modified, 'written' => true]); }
        if ($attempt === $retries) { throw new RuntimeException("Firebase {$path} changed repeatedly during the sync; the update was safely abandoned"); }
    }
    throw new RuntimeException("Unable to update Firebase {$path}");
}

function euyfc_parse_team_json($raw): array
{
    if (is_string($raw)) {
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
    return is_array($raw) ? $raw : [];
}

function euyfc_iso_now(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
}

function euyfc_input_html(array $config, string $fileKey, string $urlKey, string $environment, string $defaultUrl): string
{
    $file = euyfc_clean($config[$fileKey] ?? '');
    if ($file !== '') {
        $contents = @file_get_contents($file);
        if ($contents === false) { throw new RuntimeException("Could not read test input {$file}"); }
        return $contents;
    }
    $url = euyfc_config_value($config, $urlKey, $environment);
    return euyfc_fetch_fulltime($url !== '' ? $url : $defaultUrl);
}

function euyfc_write_status(array $status, array $config): void
{
    if (!empty($config['dry_run'])) { return; }
    if (($status['status'] ?? '') === 'failed' && empty($status['lastSuccessAt'])) {
        try {
            $previous = euyfc_firebase_get('fulltime_sync_status', $config);
            if (!empty($previous['value']['lastSuccessAt'])) { $status['lastSuccessAt'] = $previous['value']['lastSuccessAt']; }
        } catch (Throwable $ignored) {
        }
    }
    euyfc_firebase_put('fulltime_sync_status', $status, $config);
}

function euyfc_run_sync(array $config): array
{
    $attemptAt = euyfc_iso_now();
    try {
        $results = euyfc_parse_results_html(euyfc_input_html($config, 'results_file', 'fulltime_results_url', 'FULLTIME_RESULTS_URL', EUYFC_RESULTS_URL));
        $fixtures = euyfc_parse_fixtures_html(euyfc_input_html($config, 'fixtures_file', 'fulltime_fixtures_url', 'FULLTIME_FIXTURES_URL', EUYFC_FIXTURES_URL));
        if (!$results['all']) { throw new RuntimeException('No Full-Time results were recognised; no app data was changed'); }
        if (!$fixtures['all']) { throw new RuntimeException('No U13 Championship fixtures were recognised; no app data was changed'); }

        $leagueResults = null;
        $leagueFixtures = null;
        $leagueWrite = euyfc_update_path('league_matches', static function ($current) use ($results, $fixtures, &$leagueResults, &$leagueFixtures): array {
            $leagueResults = euyfc_merge_match_list($current, $results['league'], 'result');
            $leagueFixtures = euyfc_merge_match_list($leagueResults['value'], $fixtures['others'], 'fixture');
            return ['value' => $leagueFixtures['value'], 'stats' => ['results' => $leagueResults['stats'], 'fixtures' => $leagueFixtures['stats']]];
        }, $config);
        $cupWrite = euyfc_update_path('cup_matches', static fn($current): array => euyfc_merge_match_list($current, $results['cups'], 'result'), $config);
        $teamWrite = euyfc_update_path('json', static function ($raw) use ($fixtures): array {
            $merged = euyfc_merge_our_fixtures(euyfc_parse_team_json($raw), $fixtures['ours']);
            return ['value' => json_encode($merged['value'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 'stats' => $merged['stats']];
        }, $config);
        $writes = [
            'leagueResults' => ['stats' => $leagueWrite['stats']['results']],
            'leagueFixtures' => ['stats' => $leagueWrite['stats']['fixtures']],
            'cupResults' => ['stats' => $cupWrite['stats']],
            'ourFixtures' => ['stats' => $teamWrite['stats']]
        ];
        $dryRun = !empty($config['dry_run']);
        $completedAt = euyfc_iso_now();
        $status = [
            'status' => $dryRun ? 'dry-run' : 'success',
            'source' => EUYFC_AUTOMATION_SOURCE,
            'schedule' => 'Every Sunday at 18:00 Europe/London',
            'lastAttemptAt' => $attemptAt,
            'lastSuccessAt' => $dryRun ? null : $completedAt,
            'completedAt' => $completedAt,
            'message' => $dryRun ? 'Dry run completed; Firebase was not changed.' : 'Results, fixtures and league table data are up to date.',
            'results' => [
                'scraped' => count($results['all']), 'league' => count($results['league']),
                'cups' => count($results['cups']), 'ignoredEastbourne' => count($results['ignored']),
                'rejected' => count($results['rejected']), 'leagueChanges' => $writes['leagueResults']['stats'],
                'cupChanges' => $writes['cupResults']['stats']
            ],
            'fixtures' => [
                'scraped' => count($fixtures['all']), 'eastbourne' => count($fixtures['ours']),
                'otherLeague' => count($fixtures['others']), 'rejected' => count($fixtures['rejected']),
                'eastbourneChanges' => $writes['ourFixtures']['stats'], 'otherLeagueChanges' => $writes['leagueFixtures']['stats']
            ]
        ];
        euyfc_write_status($status, $config);
        if (!$dryRun) {
            $milliseconds = (int)round(microtime(true) * 1000);
            euyfc_firebase_put('app_push', [
                'id' => 'fulltime-sync-' . $milliseconds,
                'updatedAt' => $milliseconds,
                'source' => 'fulltime-automation',
                'title' => 'Fixtures and results updated',
                'message' => 'FA Full-Time results and U13 Championship fixtures were checked automatically.',
                'details' => [count($results['league']) . ' league results checked', count($results['cups']) . ' cup results checked', count($fixtures['all']) . ' league fixtures checked']
            ], $config);
        }
        return $status;
    } catch (Throwable $error) {
        $failed = [
            'status' => 'failed', 'source' => EUYFC_AUTOMATION_SOURCE,
            'schedule' => 'Every Sunday at 18:00 Europe/London',
            'lastAttemptAt' => $attemptAt, 'completedAt' => euyfc_iso_now(),
            'message' => $error->getMessage()
        ];
        try { euyfc_write_status($failed, $config); } catch (Throwable $ignored) {}
        throw $error;
    }
}
