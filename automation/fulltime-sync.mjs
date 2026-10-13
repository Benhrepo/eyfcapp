#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  AUTOMATION_SOURCE,
  CLUB,
  isEastbourne,
  mergeMatchList,
  mergeOurFixtures,
  parseFixturesHtml,
  parseResultsHtml
} from "./lib/fulltime-data.mjs";
import { fetchFullTimePage } from "./lib/http1-fetch.mjs";

export const RESULTS_URL = "https://fulltime.thefa.com/results.html?selectedSeason=2616809&selectedFixtureGroupAgeGroup=0&selectedFixtureGroupKey=1_516568481&selectedRelatedFixtureOption=3&selectedClub=&selectedTeam=&selectedDateCode=all&previousSelectedFixtureGroupAgeGroup=&previousSelectedFixtureGroupKey=&previousSelectedClub=&itemsPerPage=10000";
export const FIXTURES_URL = "https://fulltime.thefa.com/fixtures.html?league=1375655&selectedSeason=2616809&selectedDivision=655442940&selectedCompetition=0&selectedFixtureGroupKey=1_516568481&selectedDateCode=all&selectedRelatedFixtureOption=1&itemsPerPage=10000";

const DEFAULT_DATABASE_ROOT = "https://eastbourneu13-default-rtdb.firebaseio.com/eastbourne-united-u13";
const args = new Set(process.argv.slice(2));
const argValue = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
};
const dryRun = args.has("--dry-run");

function authUrl(url) {
  const token = process.env.FIREBASE_AUTH_TOKEN || "";
  const target = new URL(url);
  if (token) target.searchParams.set("auth", token);
  return target.toString();
}

function databaseUrl(path) {
  const root = (process.env.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_ROOT).replace(/\/+$/, "");
  return authUrl(`${root}/${path}.json`);
}

async function firebaseGetWithEtag(path) {
  const response = await fetch(databaseUrl(path), { headers: { "X-Firebase-ETag": "true", "Cache-Control": "no-cache" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Firebase GET ${path} failed with HTTP ${response.status}`);
  return { value: await response.json(), etag: response.headers.get("etag") };
}

async function firebasePut(path, value, etag = "") {
  const headers = { "Content-Type": "application/json" };
  if (etag) headers["if-match"] = etag;
  const response = await fetch(databaseUrl(path), { method: "PUT", headers, body: JSON.stringify(value) });
  if (response.status === 412) return { conflict: true };
  if (!response.ok) throw new Error(`Firebase PUT ${path} failed with HTTP ${response.status}`);
  return { conflict: false, value: await response.json() };
}

async function updatePath(path, merge, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const current = await firebaseGetWithEtag(path);
    const merged = merge(current.value);
    const modified = JSON.stringify(current.value) !== JSON.stringify(merged.value);
    if (dryRun || !modified) return { ...merged, modified, written: false };
    const write = await firebasePut(path, merged.value, current.etag);
    if (!write.conflict) return { ...merged, modified, written: true };
    if (attempt === retries) throw new Error(`Firebase ${path} changed repeatedly during the sync; the update was safely abandoned`);
    console.warn(`Firebase ${path} changed during sync; retrying (${attempt}/${retries})`);
  }
  throw new Error(`Unable to update Firebase ${path}`);
}

function parseTeamJson(raw) {
  if (typeof raw === "string") return JSON.parse(raw);
  return raw && typeof raw === "object" ? raw : {};
}

function pageCounts(capture = {}) {
  return {
    results: Math.max(1, Number(capture.resultsPageCount) || 1),
    fixtures: Math.max(1, Number(capture.fixturesPageCount) || 1)
  };
}

function validateParsedCapture(capture) {
  if (typeof capture?.resultsHtml !== "string" || typeof capture?.fixturesHtml !== "string") {
    throw new Error("The Full-Time page loader did not return both results and fixtures HTML; no app data was changed");
  }
  const results = parseResultsHtml(capture.resultsHtml);
  const fixtures = parseFixturesHtml(capture.fixturesHtml);
  if (!results.all.length) throw new Error("No Full-Time results were recognised; no app data was changed");
  if (!fixtures.all.length) throw new Error("No U13 Championship fixtures were recognised; no app data was changed");
  return { results, fixtures };
}

function comparableRecord(record) {
  if (!record || typeof record !== "object") return record;
  const copy = structuredClone(record);
  delete copy.fixtureOrder;
  return copy;
}

function recordDiff(beforeList, afterList, scope) {
  const before = Array.isArray(beforeList) ? beforeList : [];
  const after = Array.isArray(afterList) ? afterList : [];
  const beforeById = new Map(before.map((item, index) => [String(item?.id || `before-${index}`), item]));
  const afterById = new Map(after.map((item, index) => [String(item?.id || `after-${index}`), item]));
  const changes = [];
  afterById.forEach((item, id) => {
    const old = beforeById.get(id);
    if (!old) changes.push({ action: "added", scope, before: null, after: item });
    else if (JSON.stringify(comparableRecord(old)) !== JSON.stringify(comparableRecord(item))) changes.push({ action: "updated", scope, before: old, after: item });
  });
  beforeById.forEach((item, id) => {
    if (!afterById.has(id)) changes.push({ action: "removed", scope, before: item, after: null });
  });
  return changes;
}

function displayRecord(record = {}) {
  const isTeamFixture = Boolean(record.opponent) && !record.homeTeam && !record.awayTeam;
  const away = isTeamFixture && record.venue === "Away";
  const homeTeam = isTeamFixture ? (away ? record.opponent : CLUB) : record.homeTeam;
  const awayTeam = isTeamFixture ? (away ? CLUB : record.opponent) : record.awayTeam;
  const ourScore = Number(record.ourScore ?? -1);
  const opponentScore = Number(record.opponentScore ?? -1);
  const homeScore = isTeamFixture ? (away ? opponentScore : ourScore) : Number(record.homeScore ?? -1);
  const awayScore = isTeamFixture ? (away ? ourScore : opponentScore) : Number(record.awayScore ?? -1);
  return {
    id: String(record.id || ""),
    fullTimeFixtureId: String(record.fullTimeFixtureId || ""),
    date: record.date || "TBC",
    kickOffTime: record.kickOffTime || "",
    homeTeam: homeTeam || "",
    awayTeam: awayTeam || "",
    score: homeScore >= 0 && awayScore >= 0 ? `${homeScore}-${awayScore}` : "vs",
    competition: record.competition || record.divisionName || "League",
    venue: record.venueName || record.venue || ""
  };
}

function changedFields(before, after) {
  if (!before || !after) return [];
  const left = displayRecord(before);
  const right = displayRecord(after);
  const labels = { date: "date", kickOffTime: "kick-off", homeTeam: "home team", awayTeam: "away team", score: "score", competition: "competition", venue: "venue" };
  return Object.keys(labels).filter(key => String(left[key] || "") !== String(right[key] || "")).map(key => ({ field: labels[key], before: left[key] || "—", after: right[key] || "—" }));
}

function changeFinding(change, officialFixtures = []) {
  const record = change.after || change.before || {};
  const fallbackKey = [record.date, record.homeTeam || record.opponent, record.awayTeam, record.kickOffTime].join(":");
  const officialDuplicate = change.action === "removed" && record.fullTimeFixtureId
    && officialFixtures.some(fixture => String(fixture.fullTimeFixtureId || "") === String(record.fullTimeFixtureId));
  return {
    key: `${change.scope}:${change.action}:${record.id || record.fullTimeFixtureId || fallbackKey}`,
    action: change.action,
    scope: change.scope,
    ...displayRecord(record),
    changedFields: changedFields(change.before, change.after),
    message: change.action === "removed"
      ? officialDuplicate ? "Duplicate app record; keep the single official Full-Time fixture." : "Not present in the complete Full-Time fixture list; remove this empty league fixture."
      : change.action === "added"
        ? "New Full-Time record."
        : "Full-Time differs from the app."
  };
}

function parsedFinding(record, scope, action = "unchanged", message = "Already matches Full-Time.") {
  const fallbackKey = [record.date, record.homeTeam || record.opponent, record.awayTeam, record.kickOffTime].join(":");
  return {
    key: `${scope}:${action}:${record.id || record.fullTimeFixtureId || fallbackKey}`,
    action,
    scope,
    ...displayRecord(record),
    changedFields: [],
    message
  };
}

export async function buildSyncPreview(capture, currentData = null) {
  const { results, fixtures } = validateParsedCapture(capture);
  const current = currentData || await (async () => {
    const [league, cups, team] = await Promise.all([
      firebaseGetWithEtag("league_matches"),
      firebaseGetWithEtag("cup_matches"),
      firebaseGetWithEtag("json")
    ]);
    return { league: league.value, cups: cups.value, team: parseTeamJson(team.value) };
  })();
  const leagueResults = mergeMatchList(current.league, results.league, "result");
  const leagueFixtures = mergeMatchList(leagueResults.value, fixtures.all, "fixture", { reconcile: true });
  const cupResults = mergeMatchList(current.cups, results.cups, "result");
  const teamFixtures = mergeOurFixtures(current.team, fixtures.ours);
  const changes = [
    ...recordDiff(current.league, leagueFixtures.value, "League results & fixtures"),
    ...recordDiff(current.cups, cupResults.value, "Other clubs' cup results"),
    ...recordDiff(current.team?.fixtures, teamFixtures.value.fixtures, "Eastbourne fixture schedule")
  ];
  const findings = changes.map(change => changeFinding(change, fixtures.all));
  const changedOfficialIds = new Set(changes.flatMap(change => [change.before, change.after])
    .filter(Boolean).flatMap(record => [String(record.id || ""), String(record.fullTimeFixtureId || "")]).filter(Boolean));
  const addIfUnchanged = (record, scope) => {
    if (!changedOfficialIds.has(String(record.id || "")) && !changedOfficialIds.has(String(record.fullTimeFixtureId || ""))) {
      findings.push(parsedFinding(record, scope));
    }
  };
  results.league.forEach(record => addIfUnchanged(record, "League result"));
  results.cups.forEach(record => addIfUnchanged(record, "Other clubs' cup result"));
  fixtures.all.forEach(record => addIfUnchanged(record, isEastbourne(record.homeTeam) || isEastbourne(record.awayTeam) ? "Eastbourne league fixture" : "League fixture"));
  results.ignored.forEach(record => findings.push(parsedFinding(record, "Eastbourne result", "ignored", "Eastbourne results stay manual and will not be imported.")));
  [...results.rejected, ...fixtures.rejected].forEach((record, index) => findings.push({
    key: `rejected:${index}:${record.homeTeam || "unknown"}`,
    action: "warning",
    scope: "Unrecognised Full-Time row",
    ...displayRecord(record),
    changedFields: [],
    message: record.rejected === "unknown-league-team" ? "A team was not recognised as a U13 Championship team." : "This row could not be imported."
  }));
  const summary = findings.reduce((totals, finding) => {
    totals[finding.action] = (totals[finding.action] || 0) + 1;
    return totals;
  }, { added: 0, updated: 0, removed: 0, unchanged: 0, ignored: 0, warning: 0 });
  const pages = pageCounts(capture);
  const approvalSignature = createHash("sha256").update(JSON.stringify({ pages, counts: {
    results: results.all.length,
    fixtures: fixtures.all.length,
    rejected: results.rejected.length + fixtures.rejected.length
  }, findings })).digest("hex");
  return {
    sourcePages: pages,
    counts: {
      scrapedResults: results.all.length,
      leagueResults: results.league.length,
      cupResults: results.cups.length,
      ignoredEastbourneResults: results.ignored.length,
      scrapedFixtures: fixtures.all.length,
      eastbourneFixtures: fixtures.ours.length,
      otherLeagueFixtures: fixtures.others.length,
      rejected: results.rejected.length + fixtures.rejected.length
    },
    summary,
    findings,
    approvalSignature,
    safeToApply: summary.warning === 0,
    message: `${pages.results} results page${pages.results === 1 ? "" : "s"} and ${pages.fixtures} fixtures page${pages.fixtures === 1 ? "" : "s"} checked. Review every finding before applying.`
  };
}

function statusSummary(results, fixtures, writes, capture = {}) {
  return {
    sourcePages: pageCounts(capture),
    results: {
      scraped: results.all.length,
      league: results.league.length,
      cups: results.cups.length,
      ignoredEastbourne: results.ignored.length,
      rejected: results.rejected.length,
      leagueChanges: writes.leagueResults.stats,
      cupChanges: writes.cupResults.stats
    },
    fixtures: {
      scraped: fixtures.all.length,
      eastbourne: fixtures.ours.length,
      otherLeague: fixtures.others.length,
      rejected: fixtures.rejected.length,
      eastbourneChanges: writes.ourFixtures.stats,
      leagueListChanges: writes.leagueFixtures.stats
    }
  };
}

async function writeStatus(status) {
  if (dryRun) return;
  if (status.status === "failed" && !status.lastSuccessAt) {
    try {
      const previous = await firebaseGetWithEtag("fulltime_sync_status");
      if (previous.value?.lastSuccessAt) status.lastSuccessAt = previous.value.lastSuccessAt;
    } catch (error) {
      console.warn(`Could not read the previous sync status: ${error.message}`);
    }
  }
  await firebasePut("fulltime_sync_status", status);
}

function londonOffsetHours(date = new Date()) {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "longOffset" })
    .formatToParts(date).find(part => part.type === "timeZoneName")?.value || "GMT";
  const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) + Number(match[3] || 0) / 60);
}

function scheduledInvocationIsActive() {
  if (args.has("--cpanel-cron")) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    if (parts.weekday !== "Sun" || Number(parts.hour) !== 18) {
      console.log(`Skipping cPanel check: it is ${parts.weekday || "unknown day"} ${parts.hour || "unknown hour"}:00 in Europe/London, not Sunday 18:00.`);
      return false;
    }
  }
  if (!args.has("--scheduled") || process.env.GITHUB_EVENT_NAME !== "schedule") return true;
  const active = londonOffsetHours() === 1 ? "0 17 * * 0" : "0 18 * * 0";
  const received = process.env.GITHUB_EVENT_SCHEDULE || "";
  if (received !== active) {
    console.log(`Skipping inactive UTC schedule ${received || "unknown"}; the active 6pm Europe/London schedule is ${active}.`);
    return false;
  }
  return true;
}

async function inputHtml(fileArg, url) {
  const file = argValue(fileArg);
  return file ? readFile(file, "utf8") : fetchFullTimePage(url);
}

function logStats(label, stats) {
  console.log(`${label}: ${stats.added} added, ${stats.updated} updated, ${stats.removed || 0} removed, ${stats.unchanged} unchanged`);
}

export async function runSync(options = {}) {
  if (!scheduledInvocationIsActive()) return { skipped: true };
  const source = options.source || AUTOMATION_SOURCE;
  const schedule = options.schedule || "Every Sunday at 18:00 Europe/London";
  const attemptAt = new Date().toISOString();
  console.log(`FA Full-Time sync started at ${attemptAt}${dryRun ? " (dry run)" : ""}.`);
  try {
    let capture = {};
    if (typeof options.loadHtml === "function") {
      capture = await options.loadHtml({
        resultsUrl: process.env.FULLTIME_RESULTS_URL || RESULTS_URL,
        fixturesUrl: process.env.FULLTIME_FIXTURES_URL || FIXTURES_URL
      });
    } else {
      const [resultsHtml, fixturesHtml] = await Promise.all([
        inputHtml("--results-file", process.env.FULLTIME_RESULTS_URL || RESULTS_URL),
        inputHtml("--fixtures-file", process.env.FULLTIME_FIXTURES_URL || FIXTURES_URL)
      ]);
      capture = { resultsHtml, fixturesHtml, resultsPageCount: 1, fixturesPageCount: 1 };
    }
    const { results, fixtures } = validateParsedCapture(capture);

    let leagueResults;
    let leagueFixtures;
    const leagueWrite = await updatePath("league_matches", current => {
      leagueResults = mergeMatchList(current, results.league, "result");
      leagueFixtures = mergeMatchList(leagueResults.value, fixtures.all, "fixture", { reconcile: true });
      return { value: leagueFixtures.value, stats: { results: leagueResults.stats, fixtures: leagueFixtures.stats } };
    });
    const cupWrite = await updatePath("cup_matches", current => mergeMatchList(current, results.cups, "result"));
    const teamWrite = await updatePath("json", raw => {
      const merged = mergeOurFixtures(parseTeamJson(raw), fixtures.ours);
      return { value: JSON.stringify(merged.value), stats: merged.stats };
    });
    const writes = {
      leagueResults: { stats: leagueWrite.stats.results },
      leagueFixtures: { stats: leagueWrite.stats.fixtures },
      cupResults: { stats: cupWrite.stats },
      ourFixtures: { stats: teamWrite.stats }
    };
    const summary = statusSummary(results, fixtures, writes, capture);
    const completedAt = new Date().toISOString();
    const status = {
      status: dryRun ? "dry-run" : "success",
      source,
      schedule,
      lastAttemptAt: attemptAt,
      lastSuccessAt: dryRun ? null : completedAt,
      completedAt,
      message: dryRun ? "Dry run completed; Firebase was not changed." : "Results, fixtures and league table data are up to date.",
      ...summary
    };
    await writeStatus(status);
    if (!dryRun) {
      await firebasePut("app_push", {
        id: `fulltime-sync-${Date.now()}`,
        updatedAt: Date.now(),
        source: options.pushSource || "fulltime-automation",
        title: "Fixtures and results updated",
        message: "FA Full-Time results and U13 Championship fixtures were checked automatically.",
        details: [
          `${results.league.length} league results checked`,
          `${results.cups.length} cup results checked`,
          `${fixtures.all.length} league fixtures checked`
        ]
      });
    }
    logStats("League results", writes.leagueResults.stats);
    logStats("Other clubs' cup results", writes.cupResults.stats);
    logStats("Eastbourne fixtures", writes.ourFixtures.stats);
    logStats("All league fixtures", writes.leagueFixtures.stats);
    console.log(status.message);
    return status;
  } catch (error) {
    const failed = {
      status: "failed",
      source,
      schedule,
      lastAttemptAt: attemptAt,
      completedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error)
    };
    try { await writeStatus(failed); } catch (statusError) { console.error(`Could not record failure status: ${statusError.message}`); }
    throw error;
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  runSync()
    .then(result => {
      if (args.has("--json")) console.log(`__EUYFC_SYNC_RESULT__${JSON.stringify(result || {})}`);
    })
    .catch(error => {
      console.error(`FA Full-Time sync failed: ${error.message}`);
      if (args.has("--json")) console.log(`__EUYFC_SYNC_RESULT__${JSON.stringify({ status: "failed", message: error.message })}`);
      process.exitCode = 1;
    });
}
