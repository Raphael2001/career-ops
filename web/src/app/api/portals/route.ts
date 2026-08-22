import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe writer for portals.yml's title_filter (a USER-LAYER file). Replaces
// ONLY title_filter.positive (the role keywords the free scanner matches), seeding
// from templates/portals.example.yml on first create, and PRESERVING tracked_companies
// + every other block. Atomic write, confirm-gated (setProfile/setPortals). This is
// what loads the very first home scan once the user confirms their target roles.
//
// Text-splices each changed list in place rather than yaml.load -> mutate ->
// yaml.dump the whole document: js-yaml's dump() has no concept of "preserve
// the original text for anything unchanged" -- round-tripping the WHOLE file
// through it silently strips every comment and reformats the entire file
// (found the hard way: a save here once took portals.yml from ~2400
// documented, hand-formatted lines down to ~1200 bare ones -- same data,
// same company count, but every explanatory comment gone). Only
// title_filter.{positive,negative} and location_filter.{allow,block,
// always_allow,block_hard} are ever touched, so those are the only spans
// this rewrites; tracked_companies and everything else in the file is never
// even parsed, let alone reserialized.

type LocationFilterInput = {
  allow?: string[];
  block?: string[];
  alwaysAllow?: string[];
  blockHard?: string[];
};

function chips(value: unknown, limit = 24): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, limit);
}

/** Quote a scalar the same way the rest of portals.yml already does. */
function yamlScalar(v: string): string {
  return JSON.stringify(v);
}

/**
 * Replace (or insert) a `  key:\n    - item\n    - item\n` list block inside
 * a top-level `parentKey:` section, leaving every other byte of the file --
 * including comments -- untouched. `items: null` means "leave this key
 * alone entirely" (caller didn't ask to change it).
 */
function spliceYamlList(content: string, parentKey: string, childKey: string, items: string[] | null): string {
  if (items === null) return content;

  // Empty stays flow-style (`key: []`), matching how every filter starts
  // life and how it's written elsewhere in this file -- `key:\n` with no
  // indented children parses as `key: null` in YAML, not `[]`, and
  // downstream consumers (scan.mjs et al.) call array methods on these.
  const line = items.length
    ? `  ${childKey}:\n${items.map((v) => `    - ${yamlScalar(v)}\n`).join("")}`
    : `  ${childKey}: []\n`;
  // Matches BOTH block-style (`key:\n    - item`) and flow-style (`key: []`)
  // existing values -- the child key's colon can be followed by an inline
  // scalar (`.*`) on the same line, not just a bare newline. Without the
  // `.*`, an existing `block: []` (how every filter starts life, and how it
  // stays whenever the user hasn't excluded anything) never matches, so the
  // "insert" branch below fires instead and appends a SECOND `block:` key --
  // confirmed live: produced `duplicated mapping key` and the write was
  // rejected by the pre-write YAML parse guard.
  const childRe = new RegExp(`^  ${childKey}:.*\\n((?:    -.*\\n|    #.*\\n)*)`, "m");

  // Does the parent section exist at all?
  const parentRe = new RegExp(`^${parentKey}:\\n`, "m");
  if (!parentRe.test(content)) {
    // No title_filter:/location_filter: block at all yet -- append a fresh one.
    const block = `${parentKey}:\n${line}`;
    return content.trimEnd() + "\n\n" + block;
  }

  // Parent exists -- does this specific child key exist within it? Scope the
  // search to the parent's own span (up to the next top-level, 0-indent key)
  // so a same-named child under a DIFFERENT top-level section can't collide.
  //
  // `rest.search(/^[A-Za-z_]/m)` must run on the content AFTER the parent's
  // own `parentKey:\n` line, not on `afterParent.slice(1)` (chopping a
  // single character) -- `^` with the `m` flag matches at the very start of
  // whatever string you hand it, so slicing off just 1 char still leaves
  // that trivially-true match at position 0, and the "span" collapses to a
  // single character. Every downstream check then silently misses, and the
  // child key gets appended as a duplicate rather than replaced in place
  // (confirmed live: produced a file with two `positive:` keys under the
  // same `title_filter:`, which failed to parse at all).
  const parentStart = content.search(parentRe);
  const afterParent = content.slice(parentStart);
  const firstNewline = afterParent.indexOf("\n");
  const rest = afterParent.slice(firstNewline + 1);
  const nextTopLevelRel = rest.search(/^[A-Za-z_]/m);
  const spanEnd = nextTopLevelRel === -1 ? afterParent.length : firstNewline + 1 + nextTopLevelRel;
  const parentSpan = afterParent.slice(0, spanEnd);

  if (childRe.test(parentSpan)) {
    const newSpan = parentSpan.replace(childRe, () => line);
    return content.slice(0, parentStart) + newSpan + content.slice(parentStart + parentSpan.length);
  }

  // Parent exists, child doesn't -- insert right after the `parentKey:` line.
  const insertAt = parentStart + firstNewline + 1;
  return content.slice(0, insertAt) + line + content.slice(insertAt);
}

export async function POST(req: Request) {
  let body: { roles?: string[]; negative?: string[]; location?: string[]; locationFilter?: LocationFilterInput };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const roles = chips(body.roles);
  if (roles.length === 0) return Response.json({ error: "no roles" }, { status: 400 });

  const root = careerOpsRoot();
  const file = path.join(root, "portals.yml");

  let content: string;
  let isFreshFile = false;
  try {
    content = fs.readFileSync(file, "utf8");
    // Sanity-check it actually parses before we start splicing it.
    yaml.load(content);
  } catch {
    try {
      content = fs.readFileSync(path.join(root, "templates", "portals.example.yml"), "utf8");
      isFreshFile = true;
    } catch {
      content = "";
    }
  }

  content = spliceYamlList(content, "title_filter", "positive", roles);
  content = spliceYamlList(content, "title_filter", "negative", Array.isArray(body.negative) ? chips(body.negative) : null);

  if (body.locationFilter && typeof body.locationFilter === "object") {
    content = spliceYamlList(content, "location_filter", "allow", Array.isArray(body.locationFilter.allow) ? chips(body.locationFilter.allow) : null);
    content = spliceYamlList(content, "location_filter", "block", Array.isArray(body.locationFilter.block) ? chips(body.locationFilter.block) : null);
    content = spliceYamlList(content, "location_filter", "always_allow", Array.isArray(body.locationFilter.alwaysAllow) ? chips(body.locationFilter.alwaysAllow) : null);
    content = spliceYamlList(content, "location_filter", "block_hard", Array.isArray(body.locationFilter.blockHard) ? chips(body.locationFilter.blockHard) : null);
  } else if (Array.isArray(body.location) && body.location.length) {
    content = spliceYamlList(content, "location_filter", "allow", chips(body.location));
  }

  // Belt-and-suspenders: confirm the spliced result still parses as valid
  // YAML before it ever touches disk. A bad splice fails loudly here instead
  // of writing something the rest of career-ops can't read.
  try {
    yaml.load(content);
  } catch (e) {
    return Response.json({ error: `splice produced invalid YAML, not written: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  try {
    atomicWriteWithBackup(file, content);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, roles: roles.length, seeded: isFreshFile });
}
