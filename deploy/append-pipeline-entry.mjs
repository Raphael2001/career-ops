#!/usr/bin/env node
// Deterministically appends matched jobs to data/pipeline.md in the exact
// `- [ ] {url} | {company} | {title} | {location} | posted: {date}` format
// scan.mjs itself writes. Reads JSON from stdin:
//   {"jobs":[{"url":"...","company":"...","title":"...","location":"..."}]}
// Dedupes by URL against pipeline.md's existing lines. Deliberately dumb and
// deterministic -- headless Level-1 (claude-headless.sh) only has to decide
// WHICH jobs match, not how to format or safely edit the file.

import { readFileSync, appendFileSync, existsSync } from "node:fs";

const PIPELINE_PATH = "data/pipeline.md";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch (err) {
  console.error(`[append-pipeline-entry] invalid JSON on stdin: ${err.message}`);
  process.exit(2);
}

const jobs = Array.isArray(input.jobs) ? input.jobs : [];
if (jobs.length === 0) {
  console.error("[append-pipeline-entry] no jobs to add");
  process.exit(0);
}

const existing = existsSync(PIPELINE_PATH) ? readFileSync(PIPELINE_PATH, "utf8") : "";
const today = new Date().toISOString().slice(0, 10);

let added = 0;
const lines = [];
for (const job of jobs) {
  const url = job.url?.trim();
  if (!url || existing.includes(url)) continue;
  const company = (job.company ?? "").trim() || "Unknown";
  const title = (job.title ?? "").trim() || "Unknown role";
  const location = (job.location ?? "").trim() || "N/A";
  lines.push(`- [ ] ${url} | ${company} | ${title} | ${location} | posted: ${today}`);
  added++;
}

if (added > 0) {
  appendFileSync(PIPELINE_PATH, lines.join("\n") + "\n");
}
console.error(`[append-pipeline-entry] added ${added}/${jobs.length} (rest were duplicates or missing a url)`);
