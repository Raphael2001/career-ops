#!/usr/bin/env node
// Upgrades one tracked_companies entry in portals.yml from websearch-tier to
// a real Comeet api: entry, once the Level-1 headless scan has found the
// company's actual Comeet API URL (which can't be guessed from a slug --
// see providers/comeet.mjs -- only discovered by loading the real page).
//
// Reads JSON from stdin: {"company":"X","comeet_api_url":"https://www.comeet.co/careers-api/2.0/company/.../positions?token=..."}
// Text-splices just that one entry's block (name -> next blank line/next
// entry), preserving everything else in the file untouched -- same
// discipline as discover-ats.mjs's own writer.

import { readFileSync, writeFileSync } from "node:fs";

const PORTALS_PATH = "portals.yml";
const COMEET_HOST = "www.comeet.co";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch (err) {
  console.error(`[upgrade-to-comeet] invalid JSON on stdin: ${err.message}`);
  process.exit(2);
}

const company = input.company?.trim();
const comeetUrl = input.comeet_api_url?.trim();
if (!company || !comeetUrl) {
  console.error("[upgrade-to-comeet] need both company and comeet_api_url");
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(comeetUrl);
} catch {
  console.error(`[upgrade-to-comeet] not a valid URL: ${comeetUrl}`);
  process.exit(2);
}
if (parsed.protocol !== "https:" || parsed.hostname !== COMEET_HOST || !parsed.pathname.startsWith("/careers-api/")) {
  console.error(`[upgrade-to-comeet] doesn't look like a Comeet API URL (need https://${COMEET_HOST}/careers-api/...): ${comeetUrl}`);
  process.exit(2);
}

const content = readFileSync(PORTALS_PATH, "utf8");
const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const entryRe = new RegExp(`(^ {2}- name: "?${escaped}"?\\n(?: {4}.*\\n)*)`, "m");
const match = content.match(entryRe);

if (!match) {
  console.error(`[upgrade-to-comeet] no tracked_companies entry found for "${company}"`);
  process.exit(1);
}

const block = match[1];
if (/^ {4}api:/m.test(block)) {
  console.error(`[upgrade-to-comeet] "${company}" already has an api: entry, leaving it alone`);
  process.exit(0);
}

const lines = block.split("\n").filter((line) => line.trim() !== "");
const newLines = [];
let apiInserted = false;
for (const line of lines) {
  if (/^ {4}scan_method:/.test(line) || /^ {4}scan_query:/.test(line)) continue;
  newLines.push(line);
  if (/^ {4}careers_url:/.test(line) && !apiInserted) {
    newLines.push(`    api: ${comeetUrl}`);
    apiInserted = true;
  }
}
if (!apiInserted) newLines.splice(1, 0, `    api: ${comeetUrl}`);

const newBlock = newLines.join("\n") + "\n";
const updated = content.replace(entryRe, newBlock);
writeFileSync(PORTALS_PATH, updated);
console.error(`[upgrade-to-comeet] "${company}" upgraded to Comeet api:`);
