# AGENTS.md

Orientation for anyone, human or agent, working in this repository.

## What this is

A portfolio project: a browser-based radiology reading room for abdominal CT.
A person reads a scan, measures lesions and drafts a report; the site then
compares their read with the radiologists' outlines. An AI second reader is
being added. It is an educational demo and must stay one (docs/safety.md).
The plan and its decisions: docs/project.md; the order of work: docs/roadmap.md.

## Layout

| path | what |
|---|---|
| `pipeline/` | Python (`ctrr`): DICOM + DICOM SEG in, case bundles out |
| `web/` | React + TypeScript + Cornerstone3D static site |
| `web/public/cases/` | Case bundles. Only `phantom-01` is committed |
| `web/worker/`, `web/wrangler.jsonc` | The Cloudflare Worker that serves the site and real cases from R2 |
| `docs/` | Everything a newcomer needs; start with getting-started.md |

## Commands

```bash
cd web && pnpm install && pnpm dev          # http://localhost:5173
cd web && pnpm typecheck && pnpm test && pnpm build
cd pipeline && uv sync --extra dev && uv run pytest
cd pipeline && uv run ctrr phantom          # rebuild the synthetic tutorial case
cd pipeline && uv run ctrr fetch-kits --count 5 && uv run ctrr build-kits
cd pipeline && uv run ctrr ai-input kits-00002   # CT as NIfTI for the model
cd pipeline && uv run ctrr ai kits-00002 --prediction p.nii.gz --model model.json
cd web && pnpm deploy:check                 # wrangler dry run of the Cloudflare deploy
cd web && pnpm upload-cases                 # put local cases in the R2 bucket (docs/deploying.md)
```

## Rules that matter

**No patient data from anywhere but a public, de-identified dataset.** Nothing
from a hospital's or clinic's PACS ever enters this repository, a test, a
screenshot or a prompt. Public datasets only, each with a
licence that allows re-hosting, credited where it is shown.

**No uploads.** The site shows a fixed set of cases. A feature that takes a
visitor's scan turns a teaching demo into a diagnostic service holding health
data. Do not add one.

**The drafter states measurements; people decide what they mean.** The report
draft (`web/src/read/report.ts`, laid out by `template.ts`) lists organ, side,
size and image number. It never writes a diagnosis or an impression, and
`checker.ts` refuses any draft that does, or that states a number, side or
organ its findings lack (docs/report-format.md). A refused draft is never shown. Every number the AI shows comes from measuring
its outlines with `findings.py`, never from a language model.

**A model never reads a patient it trained on.** `ctrr ai` refuses a case whose
patient is in the model's `trainedOn` list, and ai.json says `heldOut: true`.
Its read loads only at hand-in, like the answers. Never put made-up AI output
on the site: fake predictions belong in tests.

**The case format is a contract.** `pipeline/ctrr/bundle.py` writes it,
`web/src/case/types.ts` reads it, and `docs/case-format.md` describes it.
Change all three together. The label values (`CLASSES` in
`pipeline/ctrr/seg_io.py`) are mirrored in `web/src/case/classes.ts` and
`web/src/viewer/outlines.ts`.

**Slice 0 is the most superior slice**, everywhere: the pipeline sorts head
first, the image numbers on screen are slice + 1, and the label volume uses the
same order.

**DICOM patient coordinates are LPS**: +x is the patient's left. The screen
shows the patient's right on the left (radiological convention). Side words
come from patient x, never from screen position.

**The index never gives answers away.** `index.json` lists cases without
anything about their findings (`test_index_gives_nothing_away`).

**Large arrays are never plain React props.** React's development build copies
props into its performance tracks; a 68 MB label volume passed as a prop runs
the tab out of memory. `LabelVolume` (`web/src/case/load.ts`) keeps it in a
private field.

## Gotchas

- Deploys are Cloudflare Workers Builds from `main` (docs/deploying.md). The
  `name` in `web/wrangler.jsonc` must match the Worker's name in Cloudflare.
  The `r2_buckets` binding names the bucket `ct-reading-room-cases`; a deploy
  fails if that bucket does not exist in the account. `caseKey()` in the Worker is the only thing between a URL and a
  bucket key; keep its test.

- The Vite config leaves `@cornerstonejs/dicom-image-loader`, `metadata` and
  `utils` unbundled in dev, and pre-bundles the CommonJS codecs. Changing that
  list breaks image loading in `pnpm dev` only (see the comment there).
- `scripts/copy-codecs.mjs` and `scripts/case-index.mjs` run before dev and
  build. `public/codecs/` and `public/cases/index.json` are generated, not committed.
- Some hosts decompress `labels.u8.gz` on the way (Content-Encoding: gzip),
  some do not. `loadLabels()` checks the bytes. Keep it that way.
- Reference outlines are drawn on a canvas by `web/src/viewer/outlines.ts`,
  one slice at a time, not with Cornerstone's segmentation layer, which made a
  labelmap image per slice.
