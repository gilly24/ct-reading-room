# Deploying

The site runs on **Cloudflare**: the app as a Worker with static assets, and
the real scans in an **R2** bucket the Worker reads. One account, free for a
portfolio's traffic, and R2 charges nothing for data going out, which matters
when each case is 30–130 MB.

Use a Cloudflare account of your own, not an employer's. Before the link goes
anywhere, read [safety.md](safety.md).

```
browser ──► Worker "ct-reading-room" (web/wrangler.jsonc)
              ├─ static assets: the app and the tutorial case (from the build)
              └─ /cases/*  not in the build ──► R2 bucket "ct-reading-room-cases"
```

`web/worker/index.ts` is the whole Worker: anything under `/cases/` that the
build does not have is looked up in the bucket. `/cases/index.json` always
checks the bucket first, so its list of cases wins. Same origin, so there are
no CORS rules and the bucket stays private.

## 1. The site (once)

1. Sign up at https://dash.cloudflare.com/sign-up.
2. **Workers & Pages → Create → Import a repository.** Connect GitHub, choose
   `ct-reading-room`, and set:

   | setting | value |
   |---|---|
   | Project name | `ct-reading-room` (must match `name` in `web/wrangler.jsonc`) |
   | Root directory | `web` |
   | Build command | `pnpm build` |
   | Deploy command | `npx wrangler deploy` (the default) |

3. Deploy. The address is `https://ct-reading-room.<your-subdomain>.workers.dev`.
   It shows the tutorial case, the only case in the repository.

Every push to `main` builds and deploys again.

## 2. The real scans (once, then whenever you add cases)

1. Build the cases you want online:

   ```bash
   cd pipeline
   uv run ctrr fetch-kits --count 10 --max-slices 150
   uv run ctrr build-kits
   ```

2. Create the bucket: **R2 → Create bucket**, named `ct-reading-room-cases`.
   Leave public access off; the Worker reads it.

3. Upload. Sign wrangler in once (`pnpm exec wrangler login`, or set
   `CLOUDFLARE_API_TOKEN` to a token with R2 edit rights; with more than one
   Cloudflare account, also set `CLOUDFLARE_ACCOUNT_ID`), then:

   ```bash
   cd web
   pnpm upload-cases
   ```

   It uploads every case in `web/public/cases`, then `index.json` last, so the
   list never names a case whose files are not there yet. The list names every
   case on your machine, so delete a case's folder there before uploading if you
   do not want it online. `--only kits-00002,kits-00004` re-uploads just those
   cases (plus the list) after a rebuild.

The bucket is bound to the Worker in `web/wrangler.jsonc` (`r2_buckets`), so
uploaded cases are live as soon as the upload finishes; no redeploy needed. If
you name the bucket differently, change it there too: a deploy fails when the
bucket it names does not exist.

## Trying it locally, as Cloudflare runs it

```bash
cd web
pnpm build
pnpm upload-cases --local --only kits-00004   # fills wrangler's local bucket
pnpm exec wrangler dev                         # http://localhost:8787
```

`pnpm deploy:check` runs the deploy without uploading anything, to check the
configuration.

## Limits worth knowing

- Static assets: each file at most 25 MiB, and a limited number of files per
  deploy. The app's largest file is about 4 MB. Cases go to R2, not the build,
  so neither limit is close.
- Requests for scans run the Worker, and the free plan includes a daily
  allowance of Worker requests. One read of a 260-slice case is about 270
  requests. Check current limits on Cloudflare's pricing page before you share
  the link widely.

## Checklist before sharing the link

- [ ] Only cases from datasets whose licence allows re-hosting (data.md)
- [ ] Every case shows its source and licence (it does by default)
- [ ] The "not for clinical use" notice is on every page (it is in the header)
- [ ] No upload feature
- [ ] Your own name and design; nothing of an employer's
