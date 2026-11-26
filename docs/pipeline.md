# Pipeline

`pipeline/` is a Python package, `ctrr`, that makes the cases the site reads.
[architecture.md](architecture.md) explains how it measures; this page is how
to use and change it.

## Set up

```bash
cd pipeline
uv sync --extra dev      # creates .venv from uv.lock
uv run pytest
```

Add `--extra train` (SimpleITK) for `ctrr train-data`; without it the NIfTI
tests in `tests/test_train_data.py` are skipped. CI installs both.

## Commands

| command | does |
|---|---|
| `uv run ctrr phantom` | rebuilds `web/public/cases/phantom-01` (committed) |
| `uv run ctrr fetch-kits --count N [--max-slices S] [--patients ID ...]` | downloads C4KC-KiTS studies into `.data/raw/`, resumable; skips studies over S slices (default 300) |
| `uv run ctrr build-kits` | builds a case from every fetched study |
| `uv run ctrr index` | rewrites `cases/index.json` |
| `uv run ctrr train-data [--raw DIR] [--out DIR]` | checks every fetched study and writes the nnU-Net training set and its report ([training.md](training.md)); writes no website cases |
| `uv run ctrr ai-input CASE ... [--out DIR]` | writes each case's CT as NIfTI, `DIR/<case>_0000.nii.gz`, exactly as the training set is written |
| `uv run ctrr ai CASE --prediction FILE --model model.json` | measures a model's label NIfTI for that case and adds `ai.json`, `ai-labels.u8.gz` and `ai-seg.dcm` to it |
| `--cases DIR` (before the command) | write cases somewhere other than `web/public/cases` |

## Modules

| file | job |
|---|---|
| `dicom_io.py` | read one CT series, check it, order it head first, HU |
| `seg_io.py` | DICOM SEG → label volume in the CT's order; class table |
| `findings.py` | connected lesions → measurements |
| `bundle.py` | write `case.json`, `truth.json`, `labels.u8.gz`, `index.json`, and the CT as lossless HTJ2K |
| `build.py` | a study folder (CT + one SEG) → a case |
| `phantom.py` | the synthetic abdomen, written as CT DICOM + SEG |
| `idc.py` | Imaging Data Commons downloads |
| `train_data.py` | fetched studies → nnU-Net v2 raw dataset, data checks, the fixed train/test split |
| `kits_split.json` | that split, committed: which patients train and which are held out |
| `cli.py` | the `ctrr` command |
| `nifti.py` | a case's CT out as NIfTI, a model's labels back in; refuses labels on another grid |
| `ai.py` | `model.json`, the held-out check, and a model's outlines → `ai.json`, `ai-labels.u8.gz`, `ai-seg.dcm` |

## Adding the AI's read to a case

The model is trained elsewhere, on a GPU (roadmap, milestone 2). Training writes
a `model.json` beside its weights:

```json
{ "schema": 1, "name": "nnU-Net kidney and tumour", "version": "fold 0",
  "architecture": "nnU-Net v2, 3D full resolution, residual encoder (ResEnc M)",
  "dataset": "C4KC-KiTS", "trainedOn": ["KiTS-00000", "…"],
  "labels": { "1": "kidney", "2": "tumour" }, "card": "docs/model-card.md" }
```

`trainedOn` lists every patient the model saw, validation included: for the
C4KC-KiTS model, the 170 training patients in `ctrr/kits_split.json`. `ctrr ai`
refuses a case whose patient is on it: a model reading a scan it trained on is
marking an exam it has already seen.

```bash
uv run ctrr ai-input kits-00002 kits-00003            # .data/ai-input/<case>_0000.nii.gz
nnUNetv2_predict -i .data/ai-input -o .data/ai-output -d 501 -c 3d_fullres -p nnUNetResEncUNetMPlans   # the plans you trained with
uv run ctrr ai kits-00002 --prediction .data/ai-output/kits-00002.nii.gz --model model.json
```

`ctrr ai-input` writes a case's CT exactly as `train-data` writes the training
set: head first, int16 Hounsfield units, with `train_data.ct_geometry`'s
origin, spacing and direction. nnU-Net uses arrays as it finds them, so a
model must read scans the same way up as it learned on. `read_labels` refuses
a prediction whose size, spacing, origin or direction is not the case's.
`ai-input` and `ai` need the `train` extra: `uv sync --extra train`.

## Tests

- `tests/test_phantom.py` builds the phantom through the real pipeline and
  checks every drawn lesion is found once, in the right place, at the right
  size and side; that slices are head first; that labels line up with the
  measurements; and that the index gives nothing away.
- `tests/test_findings.py` measures hand-made label volumes whose answers are
  exact, and checks segment names from real datasets map to the right class.
- `tests/test_train_data.py` checks the split (site cases held out, train and
  test never overlap, folds over training patients only, reproducible), the
  label map, and that a written NIfTI puts every voxel where the DICOM says.
- `tests/test_ai.py` runs the AI step on the phantom with predictions made from
  its own labels, some with mistakes put in: the CT written exactly as the
  training set is, label round trips, a perfect prediction measured exactly
  like the reference, missed and invented tumours, the DICOM SEG, and the
  refusal to read a patient the model trained on.

The NIfTI tests need the `train` extra and skip without it; CI installs it.

Changing a measurement rule? Change `architecture.md`'s table with it.
