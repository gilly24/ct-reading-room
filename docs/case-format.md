# Case format

A case is a folder of static files. `pipeline/ctrr/bundle.py` writes it and
`web/src/case/types.ts` reads it; change them and this page together.

```
cases/
  index.json              every case, with nothing that gives answers away
  <id>/                   lowercase letters, digits and dashes
    case.json             what the viewer needs before the read
    ct/0000.dcm …         the CT, one DICOM file per slice, head first
    truth.json            the reference lesions, loaded only at hand-in
    labels.u8.gz          the reference outlines, loaded only at hand-in
    ai.json               (milestone 2) the AI's findings
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

The CT files are the original DICOM, copied unchanged and renamed by position.

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

## labels.u8.gz

One byte per voxel, gzip-compressed, in C order: slice, then row, then column,
slices in the same head-first order as `images`. Values:

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
