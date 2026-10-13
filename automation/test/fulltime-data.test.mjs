import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mergeMatchList, mergeOurFixtures, parseFixturesHtml, parseResultsHtml } from "../lib/fulltime-data.mjs";

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
