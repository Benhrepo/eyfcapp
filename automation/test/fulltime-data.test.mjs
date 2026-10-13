import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mergeMatchList, mergeOurFixtures, parseFixturesHtml, parseResultsHtml } from "../lib/fulltime-data.mjs";
import { buildSyncPreview } from "../fulltime-sync.mjs";

const here = new URL("./", import.meta.url);

test("parses league and cup results while ignoring Eastbourne results", async () => {
  const html = await readFile(new URL("fixtures-results.html", here), "utf8");
  const parsed = parseResultsHtml(html);
  assert.equal(parsed.all.length, 3);
  assert.equal(parsed.league.length, 1);
  assert.equal(parsed.cups.length, 1);
  assert.equal(parsed.ignored.length, 1);
  assert.equal(parsed.league[0].homeTeam, "Whitehawk U13 Whitehawk u13");
  assert.equal(parsed.league[0].awayScore, 4);
  assert.equal(parsed.league[0].fullTimeFixtureId, "league-1");
});

test("parses U13 Championship fixtures only", async () => {
  const html = await readFile(new URL("fixtures-list.html", here), "utf8");
  const parsed = parseFixturesHtml(html);
  assert.equal(parsed.all.length, 2);
  assert.equal(parsed.ours.length, 1);
  assert.equal(parsed.others.length, 1);
  assert.equal(parsed.ours[0].fullTimeFixtureId, "fixture-ours");
  assert.equal(parsed.others[0].venue, "Training Ground");
});

test("builds a multi-page approval report without writing data", async () => {
  const resultsHtml = await readFile(new URL("fixtures-results.html", here), "utf8");
  const fixturesHtml = await readFile(new URL("fixtures-list.html", here), "utf8");
  const preview = await buildSyncPreview(
    { resultsHtml, fixturesHtml, resultsPageCount: 3, fixturesPageCount: 4 },
    { league: [], cups: [], team: { fixtures: [] } }
  );
  assert.deepEqual(preview.sourcePages, { results: 3, fixtures: 4 });
  assert.equal(preview.counts.scrapedResults, 3);
  assert.equal(preview.counts.scrapedFixtures, 2);
  assert.equal(preview.counts.ignoredEastbourneResults, 1);
  assert.equal(preview.summary.ignored, 1);
  assert.ok(preview.findings.some(finding => finding.scope === "Eastbourne fixture schedule" && finding.action === "added"));
  assert.equal(preview.safeToApply, true);
});

test("a changed fixture date updates the existing record and preserves a recorded score", () => {
  const current = [{ id: "stored", fullTimeFixtureId: "fixture-other", date: "11/10/2026", kickOffTime: "11:00", homeTeam: "Brighton & Hove Albion Women FC U13", awayTeam: "Saltdean United FC U13", competition: "League", homeScore: 2, awayScore: 1, scoreText: "2-1" }];
  const incoming = [{ id: "fa-fixture-fixture-other", fullTimeFixtureId: "fixture-other", date: "18/10/2026", kickOffTime: "12:00", homeTeam: "Brighton & Hove Albion Women FC U13", awayTeam: "Saltdean United FC U13", competition: "League", homeScore: -1, awayScore: -1, scoreText: "TBC" }];
  const merged = mergeMatchList(current, incoming, "fixture");
  assert.equal(merged.value.length, 1);
  assert.equal(merged.value[0].date, "18/10/2026");
  assert.equal(merged.value[0].homeScore, 2);
  assert.equal(merged.value[0].awayScore, 1);
  assert.equal(merged.stats.updated, 1);
});

test("Eastbourne fixture updates preserve all matchday data", () => {
  const team = { fixtures: [{ id: "our-stored", fullTimeFixtureId: "fixture-ours", opponent: "Horley United U13 Emerald", date: "11/10/2026", kickOffTime: "10:00", venue: "Home", competition: "League", ourScore: 6, opponentScore: 2, completed: true, matchdayEvents: [{ type: "goal" }], goalCounts: { p1: 3 }, motmPlayerId: "p1" }] };
  const row = { id: "fa-fixture-fixture-ours", fullTimeFixtureId: "fixture-ours", date: "18/10/2026", kickOffTime: "11:30", homeTeam: "Eastbourne United U13s", awayTeam: "Horley United U13 Emerald", competition: "League", venue: "The Oval" };
  const merged = mergeOurFixtures(team, [row]);
  const fixture = merged.value.fixtures[0];
  assert.equal(fixture.id, "our-stored");
  assert.equal(fixture.date, "18/10/2026");
  assert.equal(fixture.ourScore, 6);
  assert.equal(fixture.matchdayEvents.length, 1);
  assert.equal(fixture.goalCounts.p1, 3);
  assert.equal(fixture.motmPlayerId, "p1");
});

test("Eastbourne fixtures update the shared league list without duplicating team aliases", () => {
  const current = [{ id: "ft-whitehawk", date: "01/11/2026", kickOffTime: "10:00", homeTeam: "Eastbourne United U13s", awayTeam: "Whitehawk U 13", competition: "League", homeScore: -1, awayScore: -1, source: "Management" }];
  const incoming = [{ id: "fa-fixture-whitehawk", fullTimeFixtureId: "whitehawk", date: "01/11/2026", kickOffTime: "11:00", homeTeam: "Eastbourne United U13s", awayTeam: "Whitehawk U13 Whitehawk u13", competition: "League", homeScore: -1, awayScore: -1, source: "FA Full-Time Automatic Sync" }];
  const merged = mergeMatchList(current, incoming, "fixture", { reconcile: true });
  assert.equal(merged.value.length, 1);
  assert.equal(merged.value[0].fullTimeFixtureId, "whitehawk");
  assert.equal(merged.value[0].kickOffTime, "11:00");
  assert.equal(merged.stats.updated, 1);
});

test("official Eastbourne schedule removes only empty obsolete imports", () => {
  const emptyFixture = (overrides = {}) => ({
    id: "ft-old",
    opponent: "Whitehawk U 13",
    date: "01/11/2026",
    kickOffTime: "10:00",
    venue: "Home",
    competition: "League",
    ourScore: -1,
    opponentScore: -1,
    completed: false,
    playerIds: [],
    squadOrder: [],
    illnessPlayerIds: [],
    lineupPositions: [],
    goalCounts: {},
    assistCounts: {},
    goalScorers: [],
    matchPhotos: [],
    matchdayEvents: [],
    ...overrides
  });
  const team = { fixtures: [
    emptyFixture(),
    emptyFixture({ id: "fa-fixture-whitehawk", fullTimeFixtureId: "whitehawk", opponent: "Whitehawk U13 Whitehawk u13", source: "FA Full-Time Automatic Sync" }),
    emptyFixture({ id: "ft-stale-brighton", opponent: "Brighton & Hove Albion Women FC U13", date: "31/01/2027", venue: "Away" }),
    emptyFixture({ id: "management-stale-sunday", opponent: "Patcham United U13 Black", date: "18/10/2026", venue: "Home", source: "Management" }),
    emptyFixture({ id: "current-brighton", fullTimeFixtureId: "3", opponent: "Brighton & Hove Albion Women FC U13", date: "15/11/2026", venue: "Away", source: "FA Full-Time Automatic Sync" }),
    emptyFixture({ id: "current-brighton-home", fullTimeFixtureId: "6", opponent: "Brighton & Hove Albion Women FC U13", date: "06/12/2026", venue: "Home", source: "FA Full-Time Automatic Sync" }),
    emptyFixture({ id: "manual-friendly", opponent: "Local Friendly U13", date: "20/02/2027", customFixture: true }),
    emptyFixture({ id: "cup-match", opponent: "Cup Opponent U13", date: "21/02/2027", competition: "League Cup" }),
    emptyFixture({ id: "ft-with-squad", opponent: "Patcham United U13 Black", date: "18/10/2026", playerIds: ["p1"] })
  ] };
  const officialRows = [
    { id: "fa-fixture-whitehawk", fullTimeFixtureId: "whitehawk", date: "01/11/2026", kickOffTime: "11:00", homeTeam: "Eastbourne United U13s", awayTeam: "Whitehawk U13 Whitehawk u13", competition: "League", venue: "The Oval" },
    { id: "fa-2", fullTimeFixtureId: "2", date: "08/11/2026", kickOffTime: "10:00", homeTeam: "Saltdean United FC U13", awayTeam: "Eastbourne United U13s", competition: "League" },
    { id: "fa-3", fullTimeFixtureId: "3", date: "15/11/2026", kickOffTime: "10:00", homeTeam: "Brighton & Hove Albion Women FC U13", awayTeam: "Eastbourne United U13s", competition: "League" },
    { id: "fa-4", fullTimeFixtureId: "4", date: "22/11/2026", kickOffTime: "10:00", homeTeam: "Southwick U13 Black", awayTeam: "Eastbourne United U13s", competition: "League" },
    { id: "fa-5", fullTimeFixtureId: "5", date: "29/11/2026", kickOffTime: "10:00", homeTeam: "Horley United U13 Emerald", awayTeam: "Eastbourne United U13s", competition: "League" },
    { id: "fa-6", fullTimeFixtureId: "6", date: "06/12/2026", kickOffTime: "10:00", homeTeam: "Eastbourne United U13s", awayTeam: "Brighton & Hove Albion Women FC U13", competition: "League" },
    { id: "fa-7", fullTimeFixtureId: "7", date: "13/12/2026", kickOffTime: "10:00", homeTeam: "Whitehawk U13 Whitehawk u13", awayTeam: "Eastbourne United U13s", competition: "League" },
    { id: "fa-8", fullTimeFixtureId: "8", date: "10/01/2027", kickOffTime: "10:00", homeTeam: "Eastbourne United U13s", awayTeam: "ASC Brighton Rangers U13", competition: "League" }
  ];
  const merged = mergeOurFixtures(team, officialRows);
  assert.equal(merged.value.fixtures.filter(fixture => fixture.fullTimeFixtureId === "whitehawk").length, 1);
  assert.equal(merged.value.fixtures.some(fixture => fixture.id === "ft-stale-brighton"), false);
  assert.equal(merged.value.fixtures.some(fixture => fixture.id === "management-stale-sunday"), false);
  assert.equal(merged.value.fixtures.some(fixture => fixture.id === "manual-friendly"), true);
  assert.equal(merged.value.fixtures.some(fixture => fixture.id === "cup-match"), true);
  assert.equal(merged.value.fixtures.some(fixture => fixture.id === "ft-with-squad"), true);
  assert.ok(merged.stats.removed >= 2);
});

test("complete official schedule reconciles an empty management fixture in the shared list", () => {
  const current = [{ id: "management-wrong-date", date: "18/10/2026", kickOffTime: "10:00", homeTeam: "Eastbourne United U13s", awayTeam: "Southwick U13 Black", competition: "League", homeScore: -1, awayScore: -1, source: "Management" }];
  const official = Array.from({ length: 8 }, (_, index) => ({
    id: `fa-fixture-${index}`,
    fullTimeFixtureId: String(index),
    date: `${String(index + 1).padStart(2, "0")}/11/2026`,
    kickOffTime: "10:00",
    homeTeam: index % 2 ? "Eastbourne United U13s" : "Horley United U13 Emerald",
    awayTeam: index % 2 ? "Horley United U13 Emerald" : "Eastbourne United U13s",
    competition: "League",
    homeScore: -1,
    awayScore: -1
  }));
  const merged = mergeMatchList(current, official, "fixture", { reconcile: true });
  assert.equal(merged.value.some(item => item.id === "management-wrong-date"), false);
  assert.equal(merged.stats.removed, 1);
});
