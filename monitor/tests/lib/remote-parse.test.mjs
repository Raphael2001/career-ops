// Tests for the pure parsing in src/lib/remote-parse.mjs -- the actual logic
// that can silently break when discover-companies-native.sh's log format or
// `docker ps --format json`'s output shape changes. remote.ts's own docker
// exec/ps plumbing around these functions isn't covered here (needs a real
// docker socket, exercised by hand instead).
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

// Real captured `docker ps --filter label=com.docker.compose.project=career-ops
// --format json` output (2026-08-22, field order/content trimmed to what
// parseContainers actually reads) -- litellm-db has a healthcheck,
// career-ops/litellm don't.
const CAREER_OPS_LINE =
  '{"Names":"career-ops","State":"running","Status":"Up 2 hours","HealthStatus":"none","Labels":"com.docker.compose.project=career-ops,com.docker.compose.service=career-ops,com.docker.compose.container-number=1"}';
const LITELLM_LINE =
  '{"Names":"career-ops-litellm","State":"running","Status":"Up 2 hours","HealthStatus":"none","Labels":"com.docker.compose.project=career-ops,com.docker.compose.service=litellm,com.docker.compose.container-number=1"}';
const LITELLM_DB_LINE =
  '{"Names":"career-ops-litellm-db","State":"running","Status":"Up 30 hours (healthy)","HealthStatus":"healthy","Labels":"com.docker.compose.project=career-ops,com.docker.compose.service=litellm-db,com.docker.compose.container-number=1"}';

test("parseContainers: parses docker ps's newline-delimited JSON, extracting Service from Labels", () => {
  const raw = [CAREER_OPS_LINE, LITELLM_LINE, LITELLM_DB_LINE].join("\n");

  const containers = parseContainers(raw);

  assert.equal(containers.length, 3);
  assert.deepEqual(
    containers.map((c) => c.Service),
    ["career-ops", "litellm", "litellm-db"],
  );
});

test("parseContainers: HealthStatus \"none\" (no healthcheck configured) becomes undefined, not the literal string", () => {
  // Given career-ops and litellm, neither of which has a docker healthcheck
  const raw = [CAREER_OPS_LINE, LITELLM_LINE].join("\n");

  const containers = parseContainers(raw);

  // Then Health is undefined for both -- the UI's fallback (State ===
  // "running" -> "running" badge) is what should decide their display,
  // not a false "none" health reading
  assert.equal(containers[0].Health, undefined);
  assert.equal(containers[1].Health, undefined);
});

test("parseContainers: a real HealthStatus passes through as-is", () => {
  const containers = parseContainers(LITELLM_DB_LINE);

  assert.equal(containers[0].Health, "healthy");
});

test("parseContainers: Name is the container's Names field verbatim", () => {
  const containers = parseContainers(LITELLM_LINE);

  assert.equal(containers[0].Name, "career-ops-litellm");
});

test("parseContainers: blank output means no containers, not a crash", () => {
  assert.deepEqual(parseContainers(""), []);
  assert.deepEqual(parseContainers("\n\n  \n"), []);
});

test("parseContainers: a malformed line throws -- caller decides how to surface it", () => {
  // Given output that isn't valid JSON (e.g. a truncated docker response)
  const raw = "not json at all";

  // Then parsing throws rather than silently returning an empty/wrong
  // result -- getContainers in remote.ts is the layer that catches this
  // and turns it into a user-visible error, so it must not be swallowed
  // here.
  assert.throws(() => parseContainers(raw));
});
