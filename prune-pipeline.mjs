#!/usr/bin/env node
/**
 * prune-pipeline.mjs — retroactively apply portals.yml's title_filter and
 * location_filter to PENDING data/pipeline.md entries.
 *
 * scan.mjs applies both filters at write time, but a separate writer
 * (deploy/append-pipeline-entry.mjs, fed by discover-companies-native.sh's
 * headless Level-1 Playwright loop) can add entries that never went through
 * them — the loop's own prompt named title_filter.negative without ever
 * showing the headless agent what it actually contained, so a slow/free
 * backend model had to guess. This is the cleanup tool for whatever already
 * landed before that prompt was fixed to interpolate the real keyword lists.
 *
 * Preview-only by default; --write applies the removal via a straight line
 * splice (never touches `[x]` (done) rows or any non-job line — headers,
 * blanks, comments all pass through untouched).
 *
 * Usage:
 *   node prune-pipeline.mjs                # preview, JSON envelope
 *   node prune-pipeline.mjs --summary       # preview, human-readable table
 *   node prune-pipeline.mjs --write         # apply
 *   node prune-pipeline.mjs --file <path>   # use a specific pipeline file
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { buildTitleFilter } from './title-keywords.mjs';
import { buildLocationFilter } from './scan.mjs';

const DEFAULT_PIPELINE_PATH = 'data/pipeline.md';
const DEFAULT_PORTALS_PATH = 'portals.yml';

// Mirrors web/src/lib/career-ops.ts's readInbox() line format exactly — same
// `- [ ] url | company | title | location | label: value` shape — so a row
// this script keeps or drops agrees with what the dashboard shows for it.
const LABELED_SEGMENT = /^([a-z]+):\s*(.*)$/i;
const ROW_RE = /^(\s*-\s*\[)([ xX])(\]\s*)(.+)$/;

/**
 * @param {string} line
 * @returns {{done: boolean, url: string, company: string, title: string, location: string} | null}
 */
export function parsePipelineLine(line) {
  const m = line.match(ROW_RE);
  if (!m) return null;
  const [, , mark, , rest] = m;
  const all = rest.split('|').map((s) => s.trim());
  const parts = [];
  for (const [i, seg] of all.entries()) {
    const lm = i >= 3 ? seg.match(LABELED_SEGMENT) : null;
    if (!lm) parts.push(seg);
  }
  if (parts.length < 3 || !parts[0]) return null;
  return {
    done: mark.toLowerCase() === 'x',
    url: parts[0],
    company: parts[1],
    title: parts[2],
    location: parts[3] || '',
  };
}

/**
 * @param {string} raw - Full pipeline.md content.
 * @param {(title: string) => boolean} titleFilter
 * @param {(location: string, url?: string, title?: string) => boolean} locationFilter
 */
export function pruneLines(raw, titleFilter, locationFilter) {
  const lines = raw.split('\n');
  const kept = [];
  const removed = [];
  for (const line of lines) {
    const job = parsePipelineLine(line);
    // Not a job row (header/blank/comment), or already done: never touch.
    if (!job || job.done) {
      kept.push(line);
      continue;
    }
    const titleOk = titleFilter(job.title);
    const locationOk = locationFilter(job.location, job.url, job.title);
    if (titleOk && locationOk) {
      kept.push(line);
    } else {
      removed.push({
        url: job.url,
        company: job.company,
        title: job.title,
        location: job.location,
        reason: !titleOk ? 'title' : 'location',
      });
    }
  }
  return { keptText: kept.join('\n'), removed };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const summary = args.includes('--summary');
  const fileFlag = args.indexOf('--file');
  const pipelinePath = resolve(fileFlag === -1 ? DEFAULT_PIPELINE_PATH : args[fileFlag + 1] || DEFAULT_PIPELINE_PATH);
  const portalsFlag = args.indexOf('--portals-file');
  const portalsPath = resolve(portalsFlag === -1 ? DEFAULT_PORTALS_PATH : args[portalsFlag + 1] || DEFAULT_PORTALS_PATH);

  if (!existsSync(pipelinePath)) {
    console.log(JSON.stringify({ error: `no pipeline file at ${pipelinePath}` }));
    process.exitCode = 1;
    return;
  }
  const config = existsSync(portalsPath) ? yaml.load(readFileSync(portalsPath, 'utf8')) : {};
  const titleFilter = buildTitleFilter(config?.title_filter);
  const locationFilter = buildLocationFilter(config?.location_filter);

  const raw = readFileSync(pipelinePath, 'utf8');
  const { keptText, removed } = pruneLines(raw, titleFilter, locationFilter);

  if (write && removed.length > 0) {
    writeFileSync(pipelinePath, keptText);
  }

  if (summary) {
    console.log(`prune-pipeline: ${pipelinePath}`);
    console.log(`${removed.length} pending entr${removed.length === 1 ? 'y' : 'ies'} ${write ? 'removed' : 'would be removed'} (title/location filter mismatch)`);
    for (const r of removed) {
      console.log(`  - [${r.reason}] ${r.company} — ${r.title} (${r.location || 'no location'})`);
    }
    if (!write && removed.length > 0) console.log('\nRe-run with --write to apply.');
  } else {
    console.log(JSON.stringify({ pipelinePath, removed: removed.length, written: write, previewOnly: !write, removedEntries: removed }, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
