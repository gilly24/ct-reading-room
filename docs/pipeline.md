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
| `uv run ctrr fetch-kits --count N [--max-slices S] [--patients ID ...]` | downloads C4KC-KiTS studies into `.data/raw/`, resumable |
| `uv run ctrr build-kits` | builds a case from every fetched study |
| `uv run ctrr index` | rewrites `cases/index.json` |
| `uv run ctrr train-data [--raw DIR] [--out DIR]` | checks every fetched study and writes the nnU-Net training set and its report ([training.md](training.md)); writes no website cases |
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

Changing a measurement rule? Change `architecture.md`'s table with it.
