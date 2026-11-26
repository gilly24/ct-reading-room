# Training the AI second reader

Milestone 2 ([roadmap.md](roadmap.md)) adds an AI that reads the same cases as
a visitor. It is an nnU-Net v2 model (ResEnc preset) that outlines kidney and
kidney tumour. This page covers the data, the checks on it, the fixed
train/test split, and the commands to train it on a rented GPU.

The one rule: **the model is never trained, tuned or chosen on a case it is
tested on**, and the cases the website shows are always test cases.

## The data

[C4KC-KiTS](data.md#c4kc-kits-kidney-tumours) from the NCI Imaging Data
Commons, CC BY 3.0. It has 210 patients, the same patients as the KiTS19
challenge training set. Each patient has several CT phases. The DICOM SEG names
the one arterial-phase series it was drawn on, and only that series is
downloaded.

| | |
|---|---|
| Patients | 210, KiTS-00000 to KiTS-00209 |
| Outlined CT series | 210, one per patient: 45,373 slices (29 to 1,059 per series, median 107), 23.5 GB |
| SEGs | 210, 3.0 GB; each has two segments, "Kidney" and "Mass" |
| Whole collection, for comparison | 411 CT series, 36.8 GB |
| Labels for training | 0 background, 1 kidney, 2 tumour (the SEG's "Mass"); where outlines overlap, tumour wins |
| Not outlined | cysts: KiTS19 has no cyst label, so the model never learns what a cyst is |

The sizes come from idc-index's `seg_index` (IDC data release v25), which links
each SEG to the series it outlines, so they were known before anything was
downloaded.

### Getting it

```bash
cd pipeline
uv sync --extra dev --extra train
uv run ctrr fetch-kits --raw .data/train-raw --count 210 --max-slices 100000
uv run ctrr train-data --raw .data/train-raw --out .data/nnUNet_raw
```

`fetch-kits` resumes where it stopped. On a home connection (about 4 MB/s)
the download took about two hours.
`train-data` takes a few minutes with four worker processes (`--jobs`). Each
worker can need a few GB for the largest series.

**Never run `build-kits` on `.data/train-raw`.** That command turns every
study in the folder into a website case, and almost all of these patients are
for training.

`train-data` writes `.data/nnUNet_raw/Dataset501_C4KCKiTS/`:

| path | what |
|---|---|
| `imagesTr/KiTS-xxxxx_0000.nii.gz`, `labelsTr/KiTS-xxxxx.nii.gz` | the training patients: CT in Hounsfield units (int16), labels (uint8) |
| `imagesTs/`, `labelsTs/` | the held-out test patients, same format. nnU-Net never reads these folders, so it cannot plan, normalise or train on them |
| `dataset.json` | channel `CT` (nnU-Net then uses its CT normalisation), labels, `numTraining`, `SimpleITKIO` |
| `splits_final.json` | the five cross-validation folds, from the committed split |
| `validation.json`, `validation.md` | every check on every case; why any case was left out |

The NIfTI files keep this project's order: array slice 0 is the most superior
slice, and the direction matrix says so. They are written with SimpleITK,
which works in LPS like DICOM, so no axis is flipped along the way. A
`ctrr ai` command that writes a case's CT the same way gets predictions back in
the same order as the case's labels.

## The checks

Every fetched study goes through these. A study that fails any of them is left
out of training and out of testing. It never moves to the other side of the
split.

1. **Folder.** It holds one SEG and one CT series, and the SEG outlines that
   series. Every slice IDC lists is on disk, which catches an interrupted
   download.
2. **Headers.** The CT and the SEG both name the patient the folder is for,
   and they share a study and a frame of reference.
3. **CT** (`dicom_io.load_ct_series`, the same reader the website cases use).
   It is single-frame axial CT. Every slice has the same orientation, size and
   pixel spacing. No two slices share a position, and the slices are evenly
   spaced. The series is sorted head first.
4. **Slice order and orientation.** Slice 0 is the most superior. Slices step
   straight along the slice normal, with no sideways drift (that would be
   gantry tilt). The gaps between slices agree within 1%, because nnU-Net
   assumes one spacing per case.
5. **SEG geometry.** The SEG has the same rows, columns, orientation and pixel
   spacing as the CT. Every SEG frame names a CT image of this series and lies
   where that image lies (`seg_io`).
6. **Segments and labels.** The only segments are kidney and tumour, and
   after mapping the only label values are 0, 1 and 2.
7. **Content.** A kidney is outlined. The Hounsfield units are whole numbers
   that fit in int16, so nothing gets rounded. The mean HU under the kidney
   outline is soft tissue, not fat or air, which a shifted or flipped outline
   would give.
8. **Written files.** The image and the label read back with the same size,
   spacing, origin and direction. Voxel (0, 0, k) of each file lies where CT
   slice k lies.
9. **Across cases.** No patient, study, CT series or SEG appears twice, and
   no two cases have byte-identical CT pixels. Every case is in the split
   file. The same patient scanned twice and given two IDs would get past this
   check; the dataset's authors list each patient once.

`tests/test_train_data.py` checks the geometry on the synthetic phantom. Every
voxel of a written file must land where the DICOM puts it, and image and label
must share one geometry.

### Result

Run on 2026-11-26 on IDC data release v25. The full per-case report is
`validation.md` and `validation.json` next to the data. It stays out of the
repository because it lists every case's tumour volume, and the repository
does not give the website's answers away.

| | |
|---|---|
| Studies fetched | 210 of 210 |
| Passed every check | **210** |
| Left out | none |
| Training / held-out test | **170 / 40**; all five website cases are among the 40 |
| Cross-validation folds | 5, each 136 training / 34 validation patients |
| Tumour outlined | 210 of 210 (every KiTS19 patient had a kidney tumour) |
| nnU-Net's `verify_dataset_integrity` | passes (nnunetv2 2.8.1) |
| On disk | 26 GB of DICOM in, 12 GB of compressed NIfTI out |

| over the 210 cases | min | median | max |
|---|---|---|---|
| slices | 29 | 107 | 1,059 |
| image size | 512 × 512 | 512 × 512 | 512 × 796 (one case) |
| pixel spacing | 0.44 mm | 0.78 mm | 1.04 mm |
| slice spacing | 0.5 mm | 3 mm | 5 mm |
| slice thickness | 1 mm | 3 mm | 5 mm |
| kidney volume (label 1) | 91 mL | 408 mL | 1,023 mL |
| tumour volume (label 2) | 0.8 mL | 29 mL | 1,464 mL |
| mean HU under the kidney outline | 30 | 104 | 213 |

No series has gantry tilt or uneven slice gaps: the largest sideways drift
and the largest spread of gaps were both 0.00 mm. Slice spacing varies
tenfold, which nnU-Net handles by resampling every case to one target spacing.

These warnings were kept in the data:

- 47 cases have voxels below −1024 HU. Mostly they are −2048, a value
  scanners commonly give the area outside the scanned circle; a few go down
  to −10,240.
- 7 cases have metal above 3071 HU, up to 18,558.

  Neither matters to training. nnU-Net's CT normalisation clips every image
  to the 0.5 to 99.5 percentiles of the outlined voxels across the training
  set before the network sees it.
- One case (KiTS-00160) is rotated 4° in-plane. Its direction matrix records
  the rotation. nnU-Net trains on the array, and its rotation augmentation
  turns images by far more than 4°.

The most extreme cases were also checked by eye with the outlines drawn over
the image: the lowest kidney HU, the lowest tumour HU, the rotated and the
widest series, the finest pixels, the largest and smallest tumour and kidney,
and the most and fewest slices. Every outline sat on its kidney or tumour,
and the liver was on the patient's right.

## The split

`pipeline/ctrr/kits_split.json` is committed and fixed. It was made once by
`train_data.make_split()` over all 210 patients, before any check ran, so no
result can shape it.

- **Test, 40 patients**: the five website cases (KiTS-00002, -00003, -00004,
  -00006, -00007) plus the 35 other patients that come first when ordered by
  `sha256("ct-reading-room kits split 1:" + PatientID)`. No random number
  generator is involved, so every machine and Python version gives the same
  split.
- **Train, 170 patients**: everyone else.
- **Folds**: the training patients in the same hash order, dealt round-robin
  into five validation folds of 34. Each fold trains on the other 136.
  `train-data` turns these into nnU-Net's `splits_final.json` and drops any
  case that failed a check. nnU-Net does not check that a case in the split
  exists.

`tests/test_train_data.py` checks that the website cases are in the test set.
It also checks that train and test never overlap, that every patient is on
exactly one side, that the folds cover the training patients once and no test
patient, and that `make_split` still produces the committed file.

**Adding a KiTS case to the website?** Pick it from the test list. If you add
it to `SITE_CASES` and regenerate the split, the test set changes, and any
model trained on the old split has already seen the new case.

**The test set is used once.** Configurations, postprocessing and checkpoints
are chosen by cross-validation on the training patients. The test patients are
predicted and scored at the end. If a test result is used to change the model
and train again, the test set is spent, and the model card has to say so.

## Training on a rented GPU

### Which preset, which GPU

On the author's own RTX 3080 (10 or 12 GB), use ResEnc M; ai-plan.md has the
commands and a lower memory target if it runs out. The rest of this section is
for a rented GPU.

nnU-Net's ResEnc presets differ in how much GPU memory they are planned for.
These figures are from nnU-Net's own
[resenc_presets.md](https://github.com/MIC-DKFZ/nnUNet/blob/master/documentation/resenc_presets.md),
read on 2026-11-26:

| preset | planner (`-pl`) | plans (`-p`) | GPU memory (docs) | measured VRAM | training time on one A100 40 GB |
|---|---|---|---|---|---|
| M | `nnUNetPlannerResEncM` | `nnUNetResEncUNetMPlans` | "9-11GB VRAM" | 9.1 GB | ~12 h |
| L | `nnUNetPlannerResEncL` | `nnUNetResEncUNetLPlans` | "24GB VRAM" | 22.7 GB | ~35 h |
| XL | `nnUNetPlannerResEncXL` | `nnUNetResEncUNetXLPlans` | "40GB VRAM" | 36.6 GB | ~66 h |

For comparison, the original nnU-Net U-Net measured 7.7 GB and ~9 h. nnU-Net
recommends **ResEnc L** as its new default. On its KiTS2023 benchmark (489
cases, 5-fold Dice) it scored 88.17, against 86.79 for M, 88.67 for XL and
86.04 for the original U-Net. KiTS2023 is a larger, later dataset than this
one, so those numbers are a guide, not a promise.

The page does not say whether the training time is for one fold or all five.
One `nnUNetv2_train` run trains one fold, so budget it per fold: five folds of
L is roughly a week of A100 time. An epoch is a fixed number of iterations
(1000 epochs × 250 iterations by default), so the time hardly depends on how
many cases there are.

So: **L on a 24 GB card or larger** if the budget allows, otherwise **M on a
card with 10 GB or more** (nnU-Net's minimum for training). Data augmentation
runs on the CPU, so rent a machine with a good number of cores.
`nnUNet_n_proc_DA` sets how many augmentation processes nnU-Net starts.

### Set up

On the GPU machine (Linux, Python 3.12 or later, an NVIDIA driver):

```bash
# PyTorch first, built for the machine's CUDA (https://pytorch.org/get-started/locally/).
# nnU-Net's docs: "DO NOT JUST pip install nnunetv2 WITHOUT PROPERLY INSTALLING PYTORCH FIRST".
pip install torch
pip install nnunetv2            # 2.8.1 on PyPI when this was written

export nnUNet_raw=$HOME/nnunet/raw
export nnUNet_preprocessed=$HOME/nnunet/preprocessed
export nnUNet_results=$HOME/nnunet/results
```

Put `nnUNet_preprocessed` on a fast local SSD.

You can get the data onto the machine in either of two ways:

- **Rebuild it there** (recommended). IDC's files are in AWS and Google
  Cloud buckets, so a cloud machine usually downloads them much faster than a
  home connection. You also get a second, independent run of every check.
  Compare its `validation.md` with the [result](#result) above.

  ```bash
  git clone https://github.com/gilly24/ct-reading-room && cd ct-reading-room/pipeline
  pip install uv && uv sync --extra train
  uv run ctrr fetch-kits --raw .data/train-raw --count 210 --max-slices 100000
  uv run ctrr train-data --raw .data/train-raw --out $nnUNet_raw
  ```

- **Copy it** from where it was built:
  `rsync -a pipeline/.data/nnUNet_raw/Dataset501_C4KCKiTS gpu-box:nnunet/raw/`

### Plan and preprocess

```bash
nnUNetv2_plan_and_preprocess -d 501 -pl nnUNetPlannerResEncL -c 3d_fullres --verify_dataset_integrity
cp $nnUNet_raw/Dataset501_C4KCKiTS/splits_final.json $nnUNet_preprocessed/Dataset501_C4KCKiTS/
```

- `-pl` picks the preset. Use `nnUNetPlannerResEncM` and `nnUNetResEncUNetMPlans`
  below for M.
- `-c 3d_fullres` preprocesses only the configuration we train. By default
  nnU-Net also preprocesses 2d and 3d_lowres.
- **Copy `splits_final.json` before the first `nnUNetv2_train`.** Without it,
  nnU-Net makes its own random 5-fold split of `imagesTr` (seed 12345). That
  split would still contain only training patients, but its folds would not
  be the committed ones.

### Train

```bash
for fold in 0 1 2 3 4; do
  nnUNetv2_train 501 3d_fullres $fold -p nnUNetResEncUNetLPlans --npz
done
```

- `--npz` keeps the validation probabilities that
  `nnUNetv2_find_best_configuration` needs.
- With several GPUs, run one fold per GPU:
  `CUDA_VISIBLE_DEVICES=1 nnUNetv2_train 501 3d_fullres 1 -p nnUNetResEncUNetLPlans --npz`.
- nnU-Net saves a checkpoint every 50 epochs. Add `--c` to continue an
  interrupted fold, which is worth knowing on an instance that can be
  preempted.

### Choose, then test once

```bash
nnUNetv2_find_best_configuration 501 -c 3d_fullres -p nnUNetResEncUNetLPlans
```

This uses the cross-validation predictions only, and it writes
`inference_instructions.txt` (including any postprocessing) to
`$nnUNet_results/Dataset501_C4KCKiTS/`. Then predict and score the held-out
test set, once:

```bash
nnUNetv2_predict -i $nnUNet_raw/Dataset501_C4KCKiTS/imagesTs -o $HOME/nnunet/test-pred \
  -d 501 -c 3d_fullres -p nnUNetResEncUNetLPlans
# apply the postprocessing inference_instructions.txt names, then:
RUN=$nnUNet_results/Dataset501_C4KCKiTS/nnUNetTrainer__nnUNetResEncUNetLPlans__3d_fullres
nnUNetv2_evaluate_folder $nnUNet_raw/Dataset501_C4KCKiTS/labelsTs $HOME/nnunet/test-pred \
  -djfile $RUN/dataset.json -pfile $RUN/plans.json
```

`nnUNetv2_predict` uses all five folds as an ensemble by default, which
nnU-Net recommends.

### What to bring back

The run folder,
`$nnUNet_results/Dataset501_C4KCKiTS/nnUNetTrainer__nnUNetResEncUNetLPlans__3d_fullres/`,
holds `plans.json`, `dataset.json` and `fold_0` to `fold_4` with their
checkpoints. `ctrr ai` needs it, and so does the model card. The weights are
trained on CC BY 3.0 data, so credit C4KC-KiTS wherever they are shared.
