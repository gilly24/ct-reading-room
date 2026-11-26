# Case format

A case is a folder of static files. `pipeline/ctrr/bundle.py` writes it and
`web/src/case/types.ts` reads it; change them and this page together.

```
cases/
  index.json              every case, with nothing that gives answers away
  <id>/                   lowercase letters, digits and dashes
    case.json             what the viewer needs before the read
    ct/0000.dcm …         the CT, one DICOM file per slice, head first, lossless HTJ2K
    truth.json            the reference lesions, loaded only at hand-in
    labels.u8.gz          the reference outlines, loaded only at hand-in
    ai.json               the AI's findings, if a model has read the case; loaded only at hand-in
    ai-labels.u8.gz       the AI's outlines, same format as labels.u8.gz
    ai-seg.dcm            the AI's outlines as DICOM SEG, for a PACS (the site does not read it)
```

## index.json

```json
{ "schema": 1, "cases": [
  { "id": "kits-00002", "title": "Kidney CT 00002", "description": "CT abdomen, arterial phase",
    "slices": 261, "dataset": "C4KC-KiTS", "hasAi": false } ] }
```

Generated, never committed: by `scripts/case-index.mjs` before `pnpm dev` and
`pnpm build`, and by `ctrr` for cases you upload elsewhere.

## case.json

| field | meaning |
|---|---|
| `schema` | 1 |
| `id`, `title`, `description` | shown in the list and the viewer |
| `patient` | `{ age?, sex? }` from the dataset, if it has them |
| `geometry.rows`, `columns`, `slices` | image size and count |
| `geometry.pixelSpacingMm` | `[between rows, between columns]`, from DICOM PixelSpacing |
| `geometry.sliceSpacingMm`, `sliceThicknessMm` | |
| `geometry.order` | always `"head-first"`: `images[0]` is the most superior slice |
| `window` | starting window, `{ center: 40, width: 400 }` (soft tissue) |
| `images` | paths of the CT files, in display order |
| `source` | `dataset`, `collection`, `citation`, `url`, `licence`, and `patient` and `doi` for downloaded cases |
| `truth` | file name of the reference, or `null` |
| `ai` | file name of the AI findings, or `null` |

The CT files are the original DICOM, renamed by position, with the pixels
recompressed as lossless HTJ2K (transfer syntax `1.2.840.10008.1.2.4.201`),
about a third of the size. Every other element is kept, the SOP Instance UID
included. The pipeline decodes each slice again before writing it and stops if
any pixel value differs (`write_htj2k` in `bundle.py`; `tests/test_htj2k.py`
checks with a second decoder). The viewer reads the transfer syntax from each
file, so a bundle built before this, with uncompressed files, still opens.

## truth.json

```json
{ "schema": 1, "caseId": "kits-00002", "note": "who made the outlines",
  "labels": { "file": "labels.u8.gz", "shape": [261, 512, 512],
              "classes": { "1": "kidney", "2": "tumour" } },
  "lesions": [ { … } ] }
```

Each lesion:

| field | meaning |
|---|---|
| `id` | `T1`, `T2` … for tumours, `C1` … for cysts, largest first |
| `kind` | `tumour` or `cyst` |
| `organ`, `side`, `pole` | `side` is the patient's; `pole` only for kidney |
| `sliceRange` | first and last slice it is on |
| `keySlice` | where its long axis is |
| `longAxisMm`, `shortAxisMm`, `volumeCm3`, `meanHu` | measurements |
| `longAxis` | `{ slice, from: [row, col], to: [row, col] }`, pixel centres |
| `centroidWorld` | `[x, y, z]` in DICOM patient coordinates (LPS, mm) |
| `boxes` | `[slice, row0, col0, row1, col1]` for every slice it is on |

## ai.json

Written by `ctrr ai` (`pipeline/ctrr/ai.py`) from a model's outlines, measured
by the same `findings.py` as the reference, so its lesions have exactly the
truth.json shape above.

```json
{ "schema": 1, "caseId": "kits-00002",
  "model": { "name": "…", "version": "…", "architecture": "…",
             "trainedOn": { "dataset": "C4KC-KiTS", "patients": 165 },
             "outlines": ["kidney", "tumour"],
             "card": "docs/model-card.md" },
  "heldOut": true,
  "note": "who made the outlines, and that this case was not trained on",
  "labels": { "file": "ai-labels.u8.gz", "shape": [261, 512, 512],
              "classes": { "1": "kidney", "2": "tumour" } },
  "files": { "seg": "ai-seg.dcm" },
  "lesions": [ { … } ] }
```

`model.outlines` names every class the model can output, whether or not this
case has any of it. `labels.classes` lists only the classes present in this
case, so a case where the AI found no tumour has no `tumour` there; the report
needs `outlines` to say "No mass outlined by the AI" rather than "not assessed"
(report-format.md).

`heldOut` is always `true`: `ctrr ai` refuses to write findings for a case
whose patient is in the model's training list, and the site refuses an ai.json
without it. Lesion ids are the AI's own (`T1` is its largest tumour, not the
reference's T1).

## labels.u8.gz

One byte per voxel, gzip-compressed, in C order: slice, then row, then column,
slices in the same head-first order as `images`. `ai-labels.u8.gz` is the same.
Values:

| value | class |
|---|---|
| 0 | nothing |
| 1 | kidney |
| 2 | tumour |
| 3 | cyst |
| 4 | liver |
| 5 | pancreas |
| 6 | spleen |

Some hosts send `.gz` files with `Content-Encoding: gzip`, so the browser has
already decompressed it; others do not. The reader checks for the gzip magic
bytes rather than trusting either.
