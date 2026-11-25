// The Cloudflare Worker in front of the site (docs/deploying.md).
//
// Static files (the app and the committed tutorial case) are served by
// Cloudflare's asset handling before this code runs. Requests it cannot find
// there arrive here: under /cases/ they are looked up in the R2 bucket bound
// as CASES, which holds the real scans. Same origin, so no CORS rules and no
// public bucket. /cases/index.json always comes here first (run_worker_first),
// so the bucket's list of cases wins over the tutorial-only one in the build.

export interface Env {
  ASSETS: Fetcher;
  /** Bound once the bucket exists; until then every case comes from the build. */
  CASES?: R2Bucket;
}

const TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".dcm": "application/dicom",
  ".gz": "application/gzip",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (env.CASES && url.pathname.startsWith("/cases/") && (request.method === "GET" || request.method === "HEAD")) {
      const key = caseKey(url.pathname);
      if (key) {
        const object = await env.CASES.get(key);
        if (object) {
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set("etag", object.httpEtag);
          if (!headers.has("content-type")) headers.set("content-type", typeOf(key));
          // The list changes when cases are added; a case's files only when it is rebuilt.
          headers.set("cache-control", key.endsWith("/index.json") ? "public, max-age=300" : "public, max-age=86400");
          return new Response(request.method === "HEAD" ? null : object.body, { headers });
        }
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** "/cases/kits-00002/ct/0001.dcm" → "cases/kits-00002/ct/0001.dcm", or null for anything odd. */
export function caseKey(pathname: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(pathname).slice(1);
  } catch {
    return null;
  }
  if (!/^cases\/[a-z0-9][a-z0-9./_-]*$/.test(key) || key.includes("..") || key.includes("//")) return null;
  return key;
}

function typeOf(key: string): string {
  const dot = key.lastIndexOf(".");
  return TYPES[key.slice(dot)] ?? "application/octet-stream";
}
