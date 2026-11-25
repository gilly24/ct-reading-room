# Deploying

The site is static: a folder of HTML, JavaScript and case files. Any static
host works. This page uses Vercel for the site and Cloudflare R2 for the cases,
because real cases are too big for a git repository.

Before it goes public, read [safety.md](safety.md).

## The site on Vercel

1. Import the GitHub repository in Vercel.
2. Root Directory: `web`. Framework preset: Vite. Build command `pnpm build`,
   output `dist`. Vercel picks pnpm from the lockfile.
3. Deploy. With no other settings, the site shows the tutorial case only
   (it is the only case committed).

## The cases on Cloudflare R2

1. Build the cases you want online:

   ```bash
   cd pipeline
   uv run ctrr fetch-kits --count 10 --max-slices 150
   uv run ctrr build-kits
   ```

   This writes `web/public/cases/`, including `index.json`.

2. Create an R2 bucket (for example `ct-reading-room-cases`), turn on public
   access (its r2.dev URL or a custom domain), and add a CORS rule so the site
   may read it:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-site.vercel.app", "http://localhost:5173"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

3. Upload the folder. [rclone](https://rclone.org/s3/#cloudflare-r2) is the
   easiest way to sync a folder of files:

   ```bash
   rclone sync web/public/cases r2:ct-reading-room-cases/cases --progress
   ```

   The phantom goes too, so the bucket's `index.json` and the cases agree.

4. In Vercel, set an environment variable and redeploy:

   ```
   VITE_CASES_URL=https://<your-public-bucket-url>/cases/
   ```

   The site then reads `index.json` and every case from the bucket.

Cost: R2 charges nothing for data going out; storage and requests have a free
monthly allowance, and a few GB of cases sits inside or near it. Check current
pricing before you rely on that.

## Anywhere else

`pnpm build` writes `web/dist/`. Upload it to any static host. Cases either sit
in `dist/cases/` (copied from `public/cases/` by the build) or come from
`VITE_CASES_URL`.

## Checklist before sharing the link

- [ ] Only cases from datasets whose licence allows re-hosting (data.md)
- [ ] Every case shows its source and licence (it does by default)
- [ ] The "not for clinical use" notice is on every page (it is in the header)
- [ ] No upload feature
- [ ] Your own name and design; nothing of an employer's
