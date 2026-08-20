#!/usr/bin/env node
// Reads company-funded.mjs --json output on stdin, keeps only companies whose
// funding-item text mentions an Israeli hub, drops names already present in
// portals.yml's tracked_companies list, and prints a discover-ats.mjs --in
// companies.yml doc on stdout. Exits 3 (no stdout) when nothing new matches.

import { readFileSync } from "node:fs";

const GEO_RE = /israel|tel aviv|herzliya|ramat gan|petah tikva|petach tikva|haifa|jerusalem/i;

const portalsPath = process.argv[2];
if (!portalsPath) {
  console.error("usage: geo-filter.mjs <path-to-portals.yml> < funded.json");
  process.exit(2);
}

const stdin = readFileSync(0, "utf8");
let data;
try {
  data = JSON.parse(stdin);
} catch (err) {
  console.error(`[geo-filter] invalid JSON on stdin: ${err.message}`);
  process.exit(2);
}

const portalsText = readFileSync(portalsPath, "utf8");
const existingNames = new Set(
  [...portalsText.matchAll(/^\s*-\s*name:\s*"?([^"\n]+?)"?\s*$/gim)].map((m) => m[1].trim().toLowerCase())
);

const seen = new Set();
const picked = [];
for (const c of data.companies ?? []) {
  const name = c.company?.trim();
  if (!name) continue;
  const key = name.toLowerCase();
  if (existingNames.has(key) || seen.has(key)) continue;
  if (!GEO_RE.test(JSON.stringify(c))) continue;
  seen.add(key);
  picked.push(name);
}

if (picked.length === 0) {
  console.error("[geo-filter] no new geo-matched candidates this run");
  process.exit(3);
}

const lines = ["companies:", ...picked.map((name) => `  - name: "${name.replace(/"/g, '\\"')}"`)];
process.stdout.write(lines.join("\n") + "\n");
console.error(`[geo-filter] ${picked.length} new candidate(s): ${picked.join(", ")}`);
