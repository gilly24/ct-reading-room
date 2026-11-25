// Uploads web/public/cases (cases, their files and index.json) to the R2
// bucket the Worker reads (docs/deploying.md).
//
//   node scripts/upload-cases.mjs [--bucket ct-reading-room-cases] [--only kits-00002,kits-00004] [--local]
//
// Uses wrangler, so sign in first with `pnpm exec wrangler login` or set
// CLOUDFLARE_API_TOKEN. --local fills the bucket `wrangler dev` simulates.
import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(web, "public");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const bucket = option("--bucket", "ct-reading-room-cases");
const only = option("--only", null)?.split(",");
const target = args.includes("--local") ? "--local" : "--remote";

const TYPES = { ".json": "application/json; charset=utf-8", ".dcm": "application/dicom", ".gz": "application/gzip" };

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(join(root, "cases")).filter((path) => {
  const key = relative(root, path).split(sep).join("/");
  if (key === "cases/index.json") return true;
  return !only || only.includes(key.split("/")[1]);
});
// The list goes last, so it never names a case whose files are not there yet.
files.sort((a, b) => Number(a.endsWith("index.json")) - Number(b.endsWith("index.json")));

let done = 0;
let next = 0;
async function worker() {
  while (next < files.length) {
    const path = files[next++];
    const key = relative(root, path).split(sep).join("/");
    const type = TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";
    const command = ["exec", "wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", path, "--content-type", type, target];
    for (let attempt = 1; ; attempt++) {
      try {
        await run("pnpm", command, { cwd: web, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
    if (++done % 25 === 0 || done === files.length) console.log(`${done} / ${files.length}`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`uploaded ${files.length} files to ${bucket} (${target.slice(2)})`);
