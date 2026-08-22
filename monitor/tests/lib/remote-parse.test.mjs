// Tests for the pure parsing in src/lib/remote-parse.mjs -- the actual logic
// that can silently break when discover-companies-native.sh's log format or
// `docker compose ps --format json`'s output shape changes. remote.ts's own
// SSH plumbing around these functions isn't covered here (needs a live host,
// exercised by hand instead -- see the session notes in AGENTS.md/README).
//
// Run:  node --test tests/lib/remote-parse.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScanStatus, parseContainers } from "../../src/lib/remote-parse.mjs";

test("parseScanStatus: lock held means running, picks the current company and start time", () => {
  // Given the lock is held (a scan is mid-run) and a realistic log tail
  const raw = [
    "LOCK_EXIT=1",
    "[discover-native 2026-08-22T10:31:39Z] starting",
    "[discover-native 2026-08-22T10:31:39Z] pre-run cleanup (in case a previous run left orphans)",
    "[discover-native 2026-08-22T10:31:39Z] [1] Check Point Software",
    "[append-pipeline-entry] no jobs to add",
    "[discover-native 2026-08-22T10:31:39Z] [2] Cybellum",
    "[discover-native 2026-08-22T10:31:39Z] [9] DoControl",
  ].join("\n");

  const status = parseScanStatus(raw);

  // Then it reports running, on the last company seen, with the run's start time
  assert.equal(status.running, true);
  assert.equal(status.currentCompany, "DoControl");
  assert.equal(status.lastStartedAt, "2026-08-22T10:31:39Z");
});

test("parseScanStatus: lock free means idle, regardless of old log content", () => {
  // Given flock acquired the lock cleanly (nobody was holding it) but the
  // log still has yesterday's finished run in it
  const raw = ["LOCK_EXIT=0", "[discover-native 2026-08-21T21:00:00Z] starting", "[discover-native 2026-08-21T21:00:00Z] [110] Zoomin"].join(
    "\n",
  );

  const status = parseScanStatus(raw);

  // Then it reports idle -- the lock state decides "running", not whether
  // the log has content
  assert.equal(status.running, false);
});

test("parseScanStatus: no log content yet -- nulls, not a crash", () => {
  // Given the lock line but an empty log tail (script just started, no
  // output flushed yet)
  const raw = "LOCK_EXIT=1\n";

  const status = parseScanStatus(raw);

  assert.equal(status.running, true);
  assert.equal(status.currentCompany, null);
  assert.equal(status.lastStartedAt, null);
  assert.deepEqual(status.recentLines, []);
});

test("parseScanStatus: multiple runs in the log -- picks the LAST start, not the first", () => {
  // Given two runs' worth of "starting" lines (a relaunch after the first
  // finished or got killed)
  const raw = [
    "LOCK_EXIT=1",
    "[discover-native 2026-08-21T21:00:00Z] starting",
    "[discover-native 2026-08-21T21:00:00Z] [110] Zoomin",
    "[discover-native 2026-08-22T10:31:39Z] starting",
    "[discover-native 2026-08-22T10:31:39Z] [1] Check Point Software",
  ].join("\n");

  const status = parseScanStatus(raw);

  // Then it reports the most recent start, not the stale earlier one
  assert.equal(status.lastStartedAt, "2026-08-22T10:31:39Z");
});

test("parseScanStatus: timestamp-prefix brackets don't get mistaken for a company line", () => {
  // Given only timestamp-prefixed log lines and no "[N] Company" line at all
  // (e.g. the run is still in its pre-scan setup phase) -- the timestamp
  // itself is bracketed but with non-digit content, which must not match
  // the company-line pattern
  const raw = ["LOCK_EXIT=1", "[discover-native 2026-08-22T10:31:39Z] starting", "[discover-native 2026-08-22T10:31:39Z] pre-run cleanup"].join(
    "\n",
  );

  const status = parseScanStatus(raw);

  assert.equal(status.currentCompany, null);
});

test("parseScanStatus: recentLines caps at 15 and drops blank lines", () => {
  // Given 20 non-empty log lines interspersed with blank ones
  const bodyLines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const raw = ["LOCK_EXIT=1", "", ...bodyLines, ""].join("\n");

  const status = parseScanStatus(raw);

  assert.equal(status.recentLines.length, 15);
  // Then it's the LAST 15, not the first 15
  assert.equal(status.recentLines[0], "line 5");
  assert.equal(status.recentLines[14], "line 19");
});

test("parseContainers: parses docker compose ps's newline-delimited JSON", () => {
  const raw = [
    '{"Name":"career-ops-litellm","Service":"litellm","State":"running","Status":"Up 2 hours","Health":"healthy"}',
    '{"Name":"career-ops","Service":"career-ops","State":"running","Status":"Up 2 hours"}',
  ].join("\n");

  const containers = parseContainers(raw);

  assert.equal(containers.length, 2);
  assert.equal(containers[0].Service, "litellm");
  assert.equal(containers[0].Health, "healthy");
  assert.equal(containers[1].Health, undefined);
});

test("parseContainers: blank output means no containers, not a crash", () => {
  assert.deepEqual(parseContainers(""), []);
  assert.deepEqual(parseContainers("\n\n  \n"), []);
});

test("parseContainers: a malformed line throws -- caller decides how to surface it", () => {
  // Given output that isn't valid JSON (e.g. a truncated SSH response, or
  // docker printing a warning line ahead of the JSON)
  const raw = "not json at all";

  // Then parsing throws rather than silently returning an empty/wrong
  // result -- getContainers in remote.ts is the layer that catches this
  // and turns it into a user-visible error, so it must not be swallowed
  // here.
  assert.throws(() => parseContainers(raw));
});
