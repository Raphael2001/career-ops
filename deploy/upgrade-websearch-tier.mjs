#!/usr/bin/env node
// Re-probes portals.yml's websearch-tier ("no ATS") companies against the
// slug-guessable vendors discover-ats.mjs already knows how to detect
// (Greenhouse/Ashby/Lever/Workable/Recruitee/BambooHR/Breezy/Pinpoint/
// Rippling/Join), and upgrades any that resolve to a real board.
//
// discover-ats.mjs itself can't do this: its own dedupeAgainstPortals
// deliberately treats anything already in tracked_companies as a duplicate
// and skips it -- built for adding NEW companies, not re-checking existing
// ones. This script reuses its exported resolution/rendering logic
// (runDiscovery, renderPortalEntry) without modifying that file, so it
// won't conflict with the upstream-sync PRs.
//
// smartrecruiters is deliberately excluded from the vendor list: the
// original portals.yml curation pass found it returns HTTP 200 with an
// empty result for ANY slug (including nonexistent companies) and has
// matched the WRONG real company on a slug collision (e.g. "Gong" hit an
// unrelated NYC media-production firm) -- false positives worse than just
// leaving those companies on websearch-tier.
//
// Usage: node deploy/upgrade-websearch-tier.mjs [--dry-run]

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { load } from "js-yaml";
import { runDiscovery, renderPortalEntry } from "../discover-ats.mjs";

const PORTALS_PATH = "portals.yml";
const VENDORS = ["gh", "ashby", "lever", "workable", "recruitee", "bamboohr", "breezy", "pinpoint", "rippling", "join"];
const dryRun = process.argv.includes("--dry-run");

const doc = load(readFileSync(PORTALS_PATH, "utf8"));
const websearchCompanies = (doc.tracked_companies ?? []).filter(
  (e) => e && typeof e === "object" && e.enabled !== false && e.scan_method === "websearch" && e.name
);

if (websearchCompanies.length === 0) {
  console.log("No websearch-tier companies to re-probe.");
  process.exit(0);
}

console.log(`Re-probing ${websearchCompanies.length} websearch-tier companies against: ${VENDORS.join(", ")}`);

const { resolved, unresolved } = await runDiscovery(
  websearchCompanies.map((e) => ({ name: e.name })),
  { vendors: VENDORS, includeWorkday: false }
);

if (resolved.length === 0) {
  console.log(`No upgrades found (0/${websearchCompanies.length} resolved). ${unresolved.length} still unresolved.`);
  process.exit(0);
}

console.log(`\nResolved ${resolved.length}/${websearchCompanies.length}:`);
for (const r of resolved) console.log(`  - ${r.name} -> ${r.vendor} (${r.jobCount} jobs)`);

if (dryRun) {
  console.log("\n--dry-run: not writing portals.yml");
  process.exit(0);
}

let content = readFileSync(PORTALS_PATH, "utf8");
let upgradedCount = 0;

for (const match of resolved) {
  const escaped = match.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entryRe = new RegExp(`(^ {2}- name: "?${escaped}"?\\n(?: {4}.*\\n)*)`, "m");
  if (!entryRe.test(content)) {
    console.log(`  ! could not find existing entry for "${match.name}", skipping`);
    continue;
  }
  const newBlock = renderPortalEntry(match).replace(/^\n/, "");
  content = content.replace(entryRe, newBlock);
  upgradedCount++;
}

const tmpPath = `${PORTALS_PATH}.tmp-${process.pid}`;
writeFileSync(tmpPath, content, "utf8");
renameSync(tmpPath, PORTALS_PATH);
console.log(`\nUpgraded ${upgradedCount} entries in portals.yml.`);
