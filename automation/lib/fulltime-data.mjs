import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

export const CLUB = "Eastbourne United U13s";
export const LEAGUE_NAME = "Mid Sussex Youth Football League";
export const DIVISION_NAME = "U13 Championship";
export const AUTOMATION_SOURCE = "FA Full-Time Automatic Sync";

export const OFFICIAL_LEAGUE_TEAMS = Object.freeze([
  "ASC Brighton Rangers U13",
  "Brighton & Hove Albion Women FC U13",
  CLUB,
  "Horley United U13 Emerald",
  "Patcham United U13 Black",
  "Saltdean United FC U13",
  "Southwick U13 Black",
  "Whitehawk U13 Whitehawk u13"
]);

export function clean(value) {
  return String(value ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function teamLooseKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bu\s*13s?\b/g, " ")
    .replace(/\bunder\s*13s?\b/g, " ")
    .replace(/\bfootball club\b/g, " ")
    .replace(/\bfc\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OFFICIAL_BY_KEY = new Map(OFFICIAL_LEAGUE_TEAMS.map(team => [teamLooseKey(team), team]));
[
  "Eastbourne United Association Youth U13",
  "Eastbourne United Association Youth U13s",
  "Eastbourne United U13"
].forEach(alias => OFFICIAL_BY_KEY.set(teamLooseKey(alias), CLUB));
[
  "Whitehawk U13",
  "Whitehawk U 13"
].forEach(alias => OFFICIAL_BY_KEY.set(teamLooseKey(alias), "Whitehawk U13 Whitehawk u13"));

export function knownLeagueTeam(value) {
  return OFFICIAL_BY_KEY.get(teamLooseKey(value)) || "";
}

export function isEastbourne(value) {
  return knownLeagueTeam(value) === CLUB || /eastbourne\s+united.*u\s*13/i.test(clean(value));
}

export function sameTeam(left, right) {
  const leftKey = teamLooseKey(knownLeagueTeam(left) || left);
  const rightKey = teamLooseKey(knownLeagueTeam(right) || right);
  return Boolean(leftKey) && leftKey === rightKey;
}

export function parseFullTimeDateTime(value) {
  const text = clean(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}:\d{2}))?/);
  if (!match) return { date: text || "TBC", time: "" };
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return {
    date: `${String(Number(match[1])).padStart(2, "0")}/${String(Number(match[2])).padStart(2, "0")}/${year}`,
    time: match[4] || ""
  };
}

export function dateNumber(value) {
  const match = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function stableId(prefix, ...parts) {
  const digest = createHash("sha256").update(parts.map(clean).join("|")).digest("hex").slice(0, 20);
  return `${prefix}-${digest}`;
}

function fixtureIdFromElement($, element) {
  const root = $(element);
  const href = (root.is('a[href*="displayFixture.html"]') ? root.attr("href") : root.find('a[href*="displayFixture.html"]').first().attr("href")) || "";
  try {
    return new URL(href, "https://fulltime.thefa.com").searchParams.get("id") || "";
  } catch {
    return "";
  }
}

function scoreFromText(value) {
  const match = clean(value).match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  return { homeScore: Number(match[1]), awayScore: Number(match[2]), scoreText: `${match[1]}-${match[2]}` };
}

function resultRecord({ dateTime, homeTeam, awayTeam, scoreText, competition, notes = "", fullTimeFixtureId = "" }) {
  const date = parseFullTimeDateTime(dateTime);
  const score = scoreFromText(scoreText);
  if (!score || !homeTeam || !awayTeam) return null;
  const rawCompetition = clean(competition);
  const league = rawCompetition.toLowerCase() === DIVISION_NAME.toLowerCase();
  const officialHome = league ? knownLeagueTeam(homeTeam) : clean(homeTeam);
  const officialAway = league ? knownLeagueTeam(awayTeam) : clean(awayTeam);
  if (league && (!officialHome || !officialAway)) return { rejected: "unknown-league-team", homeTeam: clean(homeTeam), awayTeam: clean(awayTeam) };
  const normalizedHome = isEastbourne(homeTeam) ? CLUB : officialHome;
  const normalizedAway = isEastbourne(awayTeam) ? CLUB : officialAway;
  const id = fullTimeFixtureId ? `fa-result-${fullTimeFixtureId}` : stableId("fa-result", date.date, normalizedHome, normalizedAway, rawCompetition);
  return {
    id,
    fullTimeFixtureId,
    date: date.date,
    kickOffTime: date.time,
    homeTeam: normalizedHome,
    awayTeam: normalizedAway,
    competition: league ? "League" : rawCompetition || "Cup",
    homeScore: score.homeScore,
    awayScore: score.awayScore,
    scoreText: score.scoreText,
    leagueName: LEAGUE_NAME,
    divisionName: rawCompetition,
    notes: clean(notes),
    venue: "",
    source: AUTOMATION_SOURCE,
    ignored: isEastbourne(normalizedHome) || isEastbourne(normalizedAway),
    importBucket: league ? "league" : "cup"
  };
}

function findResultContainer($, dateElement) {
  let candidate = $(dateElement);
  for (let depth = 0; depth < 9 && candidate.length; depth += 1) {
    if (candidate.find(".home-team-col").length && candidate.find(".road-team-col").length && candidate.find(".score-col").length) return candidate;
    candidate = candidate.parent();
  }
  return null;
}

export function parseResultsHtml(html) {
  const $ = cheerio.load(String(html || ""));
  const records = [];
  const rejected = [];
  const seen = new Set();
  const add = record => {
    if (!record) return;
    if (record.rejected) { rejected.push(record); return; }
    const key = [record.fullTimeFixtureId, record.date, teamLooseKey(record.homeTeam), teamLooseKey(record.awayTeam), record.homeScore, record.awayScore].join("|");
    if (!seen.has(key)) { seen.add(key); records.push(record); }
  };

  $(".datetime-col").each((_, dateElement) => {
    const row = findResultContainer($, dateElement);
    if (!row) return;
    const notes = row.find(".score-col").siblings().map((__, element) => {
      const value = clean($(element).text());
      return /^\(.*\)$/.test(value) ? value : "";
    }).get().filter(Boolean).join(" | ");
    add(resultRecord({
      dateTime: clean(row.find(".datetime-col").first().text()),
      homeTeam: clean(row.find(".home-team-col").first().text()),
      awayTeam: clean(row.find(".road-team-col").first().text()),
      scoreText: clean(row.find(".score-col").first().text()),
      competition: clean(row.find(".fg-col").first().text()),
      notes,
      fullTimeFixtureId: fixtureIdFromElement($, row)
    }));
  });

  if (!records.length) {
    $("table tr").each((_, rowElement) => {
      const cells = $(rowElement).find("td").map((__, cell) => clean($(cell).text())).get();
      const dateIndex = cells.findIndex(value => /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}/.test(value));
      const scoreIndex = cells.findIndex(value => /\d+\s*-\s*\d+/.test(value));
      if (dateIndex < 0 || scoreIndex < 0) return;
      const homeTeam = cells.slice(dateIndex + 1, scoreIndex).find(Boolean) || "";
      const awayTeam = cells.slice(scoreIndex + 1).find(value => value && !/^\(.*\)$/.test(value)) || "";
      const competition = [...cells].reverse().find(value => /championship|cup|trophy/i.test(value)) || "";
      add(resultRecord({
        dateTime: cells[dateIndex],
        homeTeam,
        awayTeam,
        scoreText: cells[scoreIndex],
        competition,
        notes: cells.filter(value => /^\(.*\)$/.test(value)).join(" | "),
        fullTimeFixtureId: fixtureIdFromElement($, rowElement)
      }));
    });
  }

  const ignored = records.filter(record => record.ignored);
  return {
    all: records,
    league: records.filter(record => !record.ignored && record.importBucket === "league"),
    cups: records.filter(record => !record.ignored && record.importBucket === "cup"),
    ignored,
    rejected
  };
}

function fixtureRecord({ dateTime, homeTeam, awayTeam, venue, competition, fullTimeFixtureId = "" }) {
  if (clean(competition).toLowerCase() !== DIVISION_NAME.toLowerCase()) return null;
  const home = knownLeagueTeam(homeTeam);
  const away = knownLeagueTeam(awayTeam);
  if (!home || !away) return { rejected: "unknown-league-team", homeTeam: clean(homeTeam), awayTeam: clean(awayTeam) };
  const date = parseFullTimeDateTime(dateTime);
  return {
    id: fullTimeFixtureId ? `fa-fixture-${fullTimeFixtureId}` : stableId("fa-fixture", date.date, home, away),
    fullTimeFixtureId,
    date: date.date,
    kickOffTime: date.time,
    homeTeam: home,
    awayTeam: away,
    competition: "League",
    homeScore: -1,
    awayScore: -1,
    scoreText: "TBC",
    leagueName: LEAGUE_NAME,
    divisionName: DIVISION_NAME,
    notes: "",
    venue: clean(venue),
    source: AUTOMATION_SOURCE
  };
}

export function parseFixturesHtml(html) {
  const $ = cheerio.load(String(html || ""));
  const records = [];
  const rejected = [];
  const seen = new Set();
  $("table tr").each((_, rowElement) => {
    const cells = $(rowElement).find("td").map((__, cell) => clean($(cell).text())).get();
    if (cells.length < 7) return;
    const dateIndex = cells.findIndex(value => value === "TBC" || /^\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2})?/.test(value));
    const vsIndex = cells.findIndex(value => /^vs$/i.test(value));
    if (dateIndex < 0 || vsIndex < 0) return;
    const homeTeam = cells.slice(dateIndex + 1, vsIndex).find(Boolean) || "";
    const competitionIndex = cells.findIndex((value, index) => index > vsIndex && value.toLowerCase() === DIVISION_NAME.toLowerCase());
    if (competitionIndex < 0) return;
    const afterVs = cells.slice(vsIndex + 1, competitionIndex);
    const awayTeam = afterVs.find(value => knownLeagueTeam(value)) || afterVs.find(Boolean) || "";
    const awayIndex = cells.findIndex((value, index) => index > vsIndex && value === awayTeam);
    const venue = awayIndex >= 0 ? cells.slice(awayIndex + 1, competitionIndex).find(Boolean) || "" : "";
    const record = fixtureRecord({
      dateTime: cells[dateIndex],
      homeTeam,
      awayTeam,
      venue,
      competition: cells[competitionIndex],
      fullTimeFixtureId: fixtureIdFromElement($, rowElement)
    });
    if (!record) return;
    if (record.rejected) { rejected.push(record); return; }
    const key = record.fullTimeFixtureId || [record.date, teamLooseKey(record.homeTeam), teamLooseKey(record.awayTeam)].join("|");
    if (!seen.has(key)) { seen.add(key); records.push(record); }
  });
  return { all: records, ours: records.filter(row => isEastbourne(row.homeTeam) || isEastbourne(row.awayTeam)), others: records.filter(row => !isEastbourne(row.homeTeam) && !isEastbourne(row.awayTeam)), rejected };
}

function unorderedPairKey(row) {
  return [knownLeagueTeam(row?.homeTeam) || row?.homeTeam, knownLeagueTeam(row?.awayTeam) || row?.awayTeam].map(teamLooseKey).sort().join("|");
}

function orderedPairKey(row) {
  return [knownLeagueTeam(row?.homeTeam) || row?.homeTeam, knownLeagueTeam(row?.awayTeam) || row?.awayTeam].map(teamLooseKey).join("|");
}

function changed(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function findListMatch(list, row, mode) {
  if (row.fullTimeFixtureId) {
    const byId = list.findIndex(item => String(item?.fullTimeFixtureId || "") === String(row.fullTimeFixtureId));
    if (byId >= 0) return byId;
  }
  const exact = list.findIndex(item => clean(item?.date) === clean(row.date) && unorderedPairKey(item) === unorderedPairKey(row));
  if (exact >= 0) return exact;
  const rowDate = dateNumber(row.date);
  if (!Number.isFinite(rowDate)) return -1;
  const candidates = list.map((item, index) => ({ item, index, distance: Math.abs(dateNumber(item?.date) - rowDate) }))
    .filter(candidate => Number.isFinite(candidate.distance))
    .filter(candidate => mode === "result" ? unorderedPairKey(candidate.item) === unorderedPairKey(row) && candidate.distance <= 3 * 86400000 : orderedPairKey(candidate.item) === orderedPairKey(row) && candidate.distance <= 120 * 86400000)
    .filter(candidate => mode === "result" || (Number(candidate.item?.homeScore ?? -1) < 0 && Number(candidate.item?.awayScore ?? -1) < 0))
    .sort((left, right) => left.distance - right.distance);
  return candidates[0]?.index ?? -1;
}

function mergeOneListRecord(list, row, mode) {
  const index = findListMatch(list, row, mode);
  if (index < 0) return { list: [...list, row], action: "added" };
  const existing = list[index];
  const scores = mode === "fixture" && Number(existing?.homeScore ?? -1) >= 0 && Number(existing?.awayScore ?? -1) >= 0
    ? { homeScore: Number(existing.homeScore), awayScore: Number(existing.awayScore), scoreText: existing.scoreText || `${existing.homeScore}-${existing.awayScore}` }
    : {};
  const nextRecord = {
    ...existing,
    ...row,
    ...scores,
    id: existing.id || row.id,
    fullTimeFixtureId: row.fullTimeFixtureId || existing.fullTimeFixtureId || "",
    source: AUTOMATION_SOURCE
  };
  if (!changed(existing, nextRecord)) return { list, action: "unchanged" };
  const next = [...list];
  next[index] = nextRecord;
  return { list: next, action: "updated" };
}

function actionStats() {
  return { added: 0, updated: 0, unchanged: 0, removed: 0 };
}

function emptyImportedLeagueListFixture(item) {
  const imported = clean(item?.source) === AUTOMATION_SOURCE || /^(?:ft-|fa-fixture-)/.test(clean(item?.id));
  return imported
    && clean(item?.competition || "League").toLowerCase() === "league"
    && Number(item?.homeScore ?? -1) < 0
    && Number(item?.awayScore ?? -1) < 0;
}

function matchesOfficialFixture(item, row) {
  if (row.fullTimeFixtureId && String(item?.fullTimeFixtureId || "") === String(row.fullTimeFixtureId)) return true;
  return clean(item?.date) === clean(row.date) && orderedPairKey(item) === orderedPairKey(row);
}

export function mergeMatchList(current, rows, mode, options = {}) {
  let list = Array.isArray(current) ? [...current] : [];
  const stats = actionStats();
  rows.forEach(row => {
    const merged = mergeOneListRecord(list, row, mode);
    list = merged.list;
    stats[merged.action] += 1;
  });
  if (mode === "fixture" && options.reconcile === true && rows.length >= 8) {
    list = list.filter(item => {
      if (rows.some(row => matchesOfficialFixture(item, row))) return true;
      if (!emptyImportedLeagueListFixture(item)) return true;
      stats.removed += 1;
      return false;
    });
  }
  list.sort((left, right) => dateNumber(left.date) - dateNumber(right.date) || clean(left.kickOffTime).localeCompare(clean(right.kickOffTime)));
  return { value: list, stats };
}

function storedFixtureAsMatch(fixture) {
  const away = fixture?.venue === "Away";
  return {
    date: fixture?.date,
    homeTeam: away ? fixture?.opponent : CLUB,
    awayTeam: away ? CLUB : fixture?.opponent
  };
}

function findOurFixture(fixtures, row, used = new Set()) {
  const available = (_, index) => !used.has(index);
  if (row.fullTimeFixtureId) {
    const byId = fixtures.findIndex((item, index) => available(item, index) && String(item?.fullTimeFixtureId || "") === String(row.fullTimeFixtureId));
    if (byId >= 0) return byId;
  }
  const exact = fixtures.findIndex((item, index) => available(item, index) && clean(item?.date) === clean(row.date) && orderedPairKey(storedFixtureAsMatch(item)) === orderedPairKey(row));
  if (exact >= 0) return exact;
  const home = isEastbourne(row.homeTeam);
  const opponent = home ? row.awayTeam : row.homeTeam;
  const venue = home ? "Home" : "Away";
  const rowDate = dateNumber(row.date);
  const candidates = fixtures.map((item, index) => ({ item, index, distance: Math.abs(dateNumber(item?.date) - rowDate) }))
    .filter(candidate => !used.has(candidate.index) && Number.isFinite(candidate.distance) && candidate.distance <= 240 * 86400000)
    .filter(candidate => sameTeam(candidate.item?.opponent, opponent) && clean(candidate.item?.competition || "League") === "League")
    .filter(candidate => !candidate.item?.completed && Number(candidate.item?.ourScore ?? -1) < 0 && Number(candidate.item?.opponentScore ?? -1) < 0)
    .sort((left, right) => Number(right.item?.venue === venue) - Number(left.item?.venue === venue) || left.distance - right.distance);
  return candidates[0]?.index ?? -1;
}

function fixtureDataWeight(fixture) {
  const meaningful = value => {
    if (value === null || value === undefined || value === "" || value === false || value === 0) return false;
    if (Array.isArray(value)) return value.some(meaningful);
    if (typeof value === "object") return Object.values(value).some(meaningful);
    return Boolean(clean(value));
  };
  let weight = fixture?.completed ? 100 : 0;
  if (Number(fixture?.ourScore ?? -1) >= 0 || Number(fixture?.opponentScore ?? -1) >= 0) weight += 50;
  ["playerIds", "squadOrder", "illnessPlayerIds", "lineupPositions", "goalScorers", "matchPhotos", "matchdayEvents"].forEach(key => { if (meaningful(fixture?.[key])) weight += 1; });
  ["goalCounts", "assistCounts"].forEach(key => { if (meaningful(fixture?.[key])) weight += 1; });
  ["motmPlayerId", "matchReport", "matchdayStatus"].forEach(key => { if (clean(fixture?.[key])) weight += 1; });
  return weight;
}

function importedOurLeagueFixture(fixture) {
  return clean(fixture?.competition || "League").toLowerCase() === "league"
    && fixture?.customFixture !== true
    && (clean(fixture?.source) === AUTOMATION_SOURCE || /^(?:ft-|fa-fixture-)/.test(clean(fixture?.id)));
}

function emptyOurFixture(fixture) {
  return !fixture?.completed && Number(fixture?.ourScore ?? -1) < 0 && Number(fixture?.opponentScore ?? -1) < 0 && fixtureDataWeight(fixture) === 0;
}

function consolidateOurFixtureDuplicates(fixtures) {
  const output = [];
  const bySchedule = new Map();
  let removed = 0;
  fixtures.forEach(fixture => {
    const key = [clean(fixture?.date), teamLooseKey(knownLeagueTeam(fixture?.opponent) || fixture?.opponent), clean(fixture?.venue), clean(fixture?.competition || "League")].join("|");
    const priorIndex = bySchedule.get(key);
    if (priorIndex === undefined || !importedOurLeagueFixture(fixture) || !importedOurLeagueFixture(output[priorIndex])) {
      bySchedule.set(key, output.length);
      output.push(fixture);
      return;
    }
    const prior = output[priorIndex];
    if (prior?.fullTimeFixtureId && fixture?.fullTimeFixtureId && String(prior.fullTimeFixtureId) !== String(fixture.fullTimeFixtureId)) {
      output.push(fixture);
      return;
    }
    const primary = fixtureDataWeight(fixture) > fixtureDataWeight(prior) ? fixture : prior;
    const secondary = primary === fixture ? prior : fixture;
    output[priorIndex] = {
      ...secondary,
      ...primary,
      id: primary.id || secondary.id,
      fullTimeFixtureId: primary.fullTimeFixtureId || secondary.fullTimeFixtureId || "",
      source: AUTOMATION_SOURCE
    };
    removed += 1;
  });
  return { fixtures: output, removed };
}

function ourFixtureFromRow(row, existing = null) {
  const home = isEastbourne(row.homeTeam);
  const schedule = {
    id: existing?.id || row.id,
    fullTimeFixtureId: row.fullTimeFixtureId || existing?.fullTimeFixtureId || "",
    opponent: home ? row.awayTeam : row.homeTeam,
    date: row.date,
    kickOffTime: row.kickOffTime || "10:00",
    venue: home ? "Home" : "Away",
    competition: "League",
    venueName: row.venue || existing?.venueName || "",
    source: AUTOMATION_SOURCE
  };
  if (existing) return { ...existing, ...schedule };
  return {
    ...schedule,
    ourScore: -1,
    opponentScore: -1,
    completed: false,
    playerIds: [],
    squadOrder: [],
    illnessPlayerIds: [],
    formationShape: "3-3-2",
    lineupPositions: [],
    goalCounts: {},
    assistCounts: {},
    goalScorers: [],
    motmPlayerId: "",
    matchReport: "",
    matchPhotos: [],
    matchdayEvents: [],
    matchdayStatus: "",
    unassignedGoals: 0
  };
}

export function mergeOurFixtures(team, rows) {
  const nextTeam = team && typeof team === "object" ? structuredClone(team) : {};
  const consolidated = consolidateOurFixtureDuplicates(Array.isArray(nextTeam.fixtures) ? [...nextTeam.fixtures] : []);
  let fixtures = consolidated.fixtures;
  const stats = actionStats();
  stats.removed += consolidated.removed;
  const used = new Set();
  rows.forEach(row => {
    const index = findOurFixture(fixtures, row, used);
    if (index < 0) {
      fixtures.push(ourFixtureFromRow(row));
      used.add(fixtures.length - 1);
      stats.added += 1;
      return;
    }
    used.add(index);
    const merged = ourFixtureFromRow(row, fixtures[index]);
    if (changed(fixtures[index], merged)) {
      fixtures[index] = merged;
      stats.updated += 1;
    } else {
      stats.unchanged += 1;
    }
  });
  if (rows.length >= 8) {
    fixtures = fixtures.filter((fixture, index) => {
      if (used.has(index) || !importedOurLeagueFixture(fixture) || !emptyOurFixture(fixture)) return true;
      stats.removed += 1;
      return false;
    });
  }
  fixtures.sort((left, right) => dateNumber(left.date) - dateNumber(right.date) || clean(left.kickOffTime).localeCompare(clean(right.kickOffTime)));
  fixtures.forEach((fixture, index) => { fixture.fixtureOrder = index; });
  nextTeam.fixtures = fixtures;
  return { value: nextTeam, stats };
}
