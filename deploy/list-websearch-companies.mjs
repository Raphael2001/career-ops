#!/usr/bin/env node
// Reads portals.yml's tracked_companies and prints, one JSON object per line
// (NDJSON), every enabled entry whose scan_method is "websearch" -- the exact
// set scan.mjs's own agentHandoff logic would report (see scan.mjs's
// resolveEntries: entry.scan_method === 'websearch' after resolveProvider
// fails). Used by discover-companies.sh to drive the per-company headless
// Level-1 loop without depending on scan.mjs's console output.

import { readFileSync } from "node:fs";
import { load } from "js-yaml";

const portalsPath = process.argv[2] || "portals.yml";
const doc = load(readFileSync(portalsPath, "utf8"));

for (const entry of doc.tracked_companies ?? []) {
  if (!entry || typeof entry !== "object") continue;
  if (entry.enabled === false) continue;
  if (entry.scan_method !== "websearch") continue;
  if (!entry.name || !entry.careers_url) continue;
  process.stdout.write(JSON.stringify({ name: entry.name, careers_url: entry.careers_url }) + "\n");
}
