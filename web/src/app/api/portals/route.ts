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

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

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
  let doc: Record<string, unknown> = {};
  try {
    doc = (yaml.load(fs.readFileSync(file, "utf8")) as Record<string, unknown>) || {};
  } catch {
    try {
      doc = (yaml.load(fs.readFileSync(path.join(root, "templates", "portals.example.yml"), "utf8")) as Record<string, unknown>) || {};
    } catch {
      doc = {};
    }
  }

  const tf = isObj(doc.title_filter) ? { ...doc.title_filter } : {};
  tf.positive = roles; // replace ONLY the positive keywords; keep negative/etc.
  if (Array.isArray(body.negative)) tf.negative = chips(body.negative);
  doc.title_filter = tf;
  if (body.locationFilter && typeof body.locationFilter === "object") {
    const lf = isObj(doc.location_filter) ? { ...doc.location_filter } : {};
    if (Array.isArray(body.locationFilter.allow)) lf.allow = chips(body.locationFilter.allow);
    if (Array.isArray(body.locationFilter.block)) lf.block = chips(body.locationFilter.block);
    if (Array.isArray(body.locationFilter.alwaysAllow)) lf.always_allow = chips(body.locationFilter.alwaysAllow);
    if (Array.isArray(body.locationFilter.blockHard)) lf.block_hard = chips(body.locationFilter.blockHard);
    doc.location_filter = lf;
  } else if (Array.isArray(body.location) && body.location.length) {
    const lf = isObj(doc.location_filter) ? { ...doc.location_filter } : {};
    lf.allow = chips(body.location);
    doc.location_filter = lf;
  }

  try {
    atomicWriteWithBackup(file, yaml.dump(doc, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, roles: roles.length });
}
