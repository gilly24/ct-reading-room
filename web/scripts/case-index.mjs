// Writes public/cases/index.json from the cases that are actually there, so a
// fresh clone lists the tutorial case and a machine with downloaded cases
// lists those too. Runs before dev and build. The pipeline writes the same
// file (pipeline/ctrr/bundle.py write_index) for cases hosted elsewhere.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cases = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "cases");
const entries = [];
for (const id of existsSync(cases) ? readdirSync(cases) : []) {
  const file = join(cases, id, "case.json");
  if (!existsSync(file)) continue;
  const meta = JSON.parse(readFileSync(file, "utf8"));
  entries.push({
    id: meta.id,
    title: meta.title,
    description: meta.description,
    slices: meta.geometry.slices,
    dataset: meta.source?.dataset ?? null,
    hasAi: Boolean(meta.ai),
  });
}
// The phantom is the tutorial, so it goes first.
entries.sort((a, b) => Number(!a.id.startsWith("phantom")) - Number(!b.id.startsWith("phantom")) || a.id.localeCompare(b.id));
writeFileSync(join(cases, "index.json"), JSON.stringify({ schema: 1, cases: entries }, null, 1) + "\n");
console.log(`case index: ${entries.map((e) => e.id).join(", ") || "no cases"}`);
