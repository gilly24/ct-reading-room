# The AI second reader: plan

How the AI is built, trained, checked and shown. What already exists is in
pipeline.md (`ctrr ai-input`, `ctrr ai`) and case-format.md (`ai.json`); this
page is what comes next. Decisions and their reasons: project.md.

## The pieces

| Piece | What | Status |
|---|---|---|
| `ctrr ai-input`, `ctrr ai` | CT out as NIfTI; a model's labels in, measured by `findings.py`, written as `ai.json`, `ai-labels.u8.gz`, `ai-seg.dcm`; refuses trained patients | Built, tested |
| Site AI layer | After hand-in: AI outlines and boxes, AI score beside the reader's, findings checked, report from the AI | Built, tested |
| `ctrr kits23-dataset` | KiTS23 → nnU-Net training folder, with the hold-outs removed and `model.json` written | To build |
| The kidney model | nnU-Net v2, ResEnc M, 3D full resolution, fold 0 | To train |
| `ctrr evaluate` | Held-out results for the model card | To build |
| Anatomy | TotalSegmentator "total" model on every site case | To build |
| Template report + checker | report-format.md | To build |
| DICOM SR | The AI's measurements as a TID 1500 measurement report | To build |
| Report with AI | Pre-filled AI findings the reader accepts or rejects | To build |
| `docs/model-card.md` | Data, intended use, held-out results, failures | After training |

## Data

**KiTS23**: CT with kidney, tumour and cyst outlines from patients having
kidney surgery, contrast-enhanced. 489 cases with labels. Label values 1
kidney, 2 tumour, 3 cyst: the same as ours (`seg_io.CLASSES`), so no mapping
is needed. Licence CC BY-NC-SA: fine for this non-commercial project, and the
trained model inherits it. Downloaded with the `kits23` package on the training
machine, never committed.

**Overlap with the site.** KiTS23 includes the KiTS19 patients, who are the
C4KC-KiTS patients the site shows (kits-00002, -00003, -00004, -00006, -00007).
`case_00002` in KiTS23 is very likely `KiTS-00002` in C4KC-KiTS, but check
before trusting it: same slice count, same spacing, and the same voxel values
once both are in Hounsfield units. `ctrr kits23-dataset` does this check and
stops if it fails.

## Splits

Fixed once, before training, written to `pipeline/splits/kits23.json`
(committed, so anyone can see what was held out):

1. **Site cases**: every patient the site shows, under both names. Never trained on.
2. **Test group**: about 50 cases picked with a fixed random seed. Never
   trained on, never looked at until the model is final. The model card's
   numbers come from these.
3. **Training pool**: the rest, about 430. nnU-Net splits it again internally
   (fold 0 holds back a fifth for validation). `model.json` lists every patient
   in the pool as `trainedOn`, validation included.

## Training on the RTX 3080

The machine needs an NVIDIA driver recent enough for current PyTorch, about 32
GB of RAM, a CPU with several cores (nnU-Net prepares training patches on the
CPU while the GPU trains), and roughly 100–150 GB of free disk for the
download, the preprocessed data and the results. On Windows, WSL2 (Linux inside
Windows) is the smoother route.

```bash
nvidia-smi                                   # card, memory, driver
pip install nnunetv2                         # in a venv, after PyTorch with CUDA
export nnUNet_raw=… nnUNet_preprocessed=… nnUNet_results=…
uv run ctrr kits23-dataset --kits23 /data/kits23 --out $nnUNet_raw   # to build
nnUNetv2_plan_and_preprocess -d 501 -pl nnUNetPlannerResEncM --verify_dataset_integrity
nnUNetv2_train 501 3d_fullres 0 -p nnUNetResEncUNetMPlans
```

ResEnc M used 9.1 GB in its authors' runs. On a 10 GB card, if training runs
out of memory, plan for less and train with the new plans:

```bash
nnUNetv2_plan_experiment -d 501 -pl nnUNetPlannerResEncM -gpu_memory_target 8 -overwrite_plans_name nnUNetResEncUNetPlans_8G
nnUNetv2_train 501 3d_fullres 0 -p nnUNetResEncUNetPlans_8G
```

About 12 hours on an A100 for its authors; expect roughly one to two days on a
3080. Training saves checkpoints and continues with `--c` after a stop.

## Predicting and adding to the site

```bash
uv run ctrr ai-input kits-00002 kits-00003 kits-00004 kits-00006 kits-00007
nnUNetv2_predict -i .data/ai-input -o .data/ai-output -d 501 -c 3d_fullres -f 0 -p nnUNetResEncUNetMPlans
uv run ctrr ai kits-00002 --prediction .data/ai-output/kits-00002.nii.gz --model model.json   # each case
cd ../web && pnpm upload-cases
```

The phantom can be read too: it is nobody, so it was never trained on.

## Evaluation (`ctrr evaluate`, for the model card)

On the test group only, never tuned against:

- **Per lesion**: found, missed, false positives per scan. A predicted lesion
  is on a reference lesion when they overlap in 3D; the site's own long-axis
  rule is reported alongside, since that is how readers are scored.
- **By size**: under 2 cm, 2–4 cm, over 4 cm. Small masses are where models
  and people both struggle.
- **Mass or cyst**: how often each is called the other.
- **Size**: long-axis error in mm against the reference.
- **Overlap**: Dice for kidney, tumour and cyst.
- **Failures**: the worst cases, with images, named in the model card.

## Anatomy with TotalSegmentator

The open "total" model (Apache 2.0) outlines over 100 structures. It runs on a
CPU with `--fast`, so it can run anywhere, not only on the GPU machine. For
each site case it gives:

- the organs present in the scan, so the AI's report knows which organs it can
  speak about, and which it must say it did not assess;
- an organ for each AI lesion, checked against the kidney model's own;
- simple organ measurements (lengths and volumes), stated as measurements.

This adds an `anatomy` entry to the case format (bundle.py, types.ts and
case-format.md together). Only the open "total" task is used: some other
TotalSegmentator tasks need a licence.

## Known limits, for the model card

- Contrast-enhanced CT only. Non-contrast scans, like the example template's,
  are outside what it was trained on.
- Every KiTS patient had a kidney mass. It has seen few normal kidneys, so it
  may over-call on scans without one.
- A teaching aid: never for clinical use (safety.md).

## If time allows

- Region-based training (kidney+masses, masses, tumour), which KiTS entries used.
- ResEnc L or all five folds on a bigger GPU.
- Train Auto3DSeg SegResNet to fit the 3080 and compare the two on the test
  group: two AIs that disagree are good teaching material.
