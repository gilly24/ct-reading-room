# Phase 1: train and evaluate the kidney model

The plan for the first phase of the roadmap, run by the author on their own
RTX 3080. It ends with a trained model, one honest test on patients it never
saw, a model card, and the model's read live on the site. Record every step
in [training-diary.md](training-diary.md).

## Done when

- [ ] nnU-Net ResEnc M, fold 0, trained on the 136 training patients of fold 0
- [ ] Its validation result (34 patients) recorded, and the settings frozen
- [ ] The 40 held-out patients predicted and scored **once**
- [ ] `docs/model-card.md` written from that score, limits included
- [ ] The model's read on the five site cases, live after hand-in
- [ ] The diary filled in, step by step

## Rules that do not bend

1. **The test set is used once.** Nothing is changed because of a test result.
   If something is, the model card says so and the test no longer counts as unseen.
2. **Choices are made on validation, never on test.** Validation (fold 0's 34
   patients) is for checking and choosing; test (the 40) is for the final score.
3. **The split never changes** (`pipeline/ctrr/kits_split.json`). Its tests fail
   if it does.
4. **Everything goes in the diary**, including what went wrong.

## Who does what

| You | Claude |
|---|---|
| Machine set-up, data, training, prediction | `ctrr model-json`: writes `model.json` with the 170 training patients |
| Read the plans and the training log, decide on problems | Help when something breaks; review |
| Run the evaluation, write the model card | `ctrr evaluate`, unless you write it (step E) |
| Run `ctrr ai` and upload | The template report drafter, in parallel |

## The steps

Times assume things go to plan; the diary records when they do not.

### A. The machine (half a day)

Follow parts 0–2 of the set-up guide in [ai-plan.md](ai-plan.md) and
[training.md](training.md): `nvidia-smi` in Windows, WSL2 with Ubuntu,
`nvidia-smi` again inside Ubuntu, the project's tools with
`uv sync --extra dev --extra train`, a separate venv with PyTorch (CUDA) and
`nnunetv2`, and the three `nnUNet_*` folders in your Linux home.

*Check:* `python -c "import torch; print(torch.cuda.is_available())"` prints `True`.
*Diary:* GPU memory, driver and CUDA versions, RAM, free disk, PyTorch and nnU-Net versions.

### B. The data (hours of downloading, a few minutes of work)

```bash
uv run ctrr fetch-kits --raw .data/train-raw --count 210 --max-slices 100000
uv run ctrr train-data --raw .data/train-raw --out $nnUNet_raw
```

*Check:* `validation.md` says 210 passed, 170 train, 40 test, with the same
warnings as training.md's result. If not, stop.
*Diary:* how long the download took, anything that differed.

### C. Planning (an hour or two)

```bash
nnUNetv2_plan_and_preprocess -d 501 -pl nnUNetPlannerResEncM -c 3d_fullres --verify_dataset_integrity
cp $nnUNet_raw/Dataset501_C4KCKiTS/splits_final.json $nnUNet_preprocessed/Dataset501_C4KCKiTS/
```

*Learn:* open `nnUNetResEncUNetMPlans.json`, find `3d_fullres`, and note the
target spacing, patch size, batch size and how many stages the network has.
Work out why: the spacing is near the dataset's median, the patch is the
largest that fits the memory target, and the network halves the patch until
it is a few voxels across.
*Diary:* those four values, and your explanation of each.

### D. Training (one to three days)

In `tmux`, with the nnU-Net venv active:

```bash
nnUNetv2_train 501 3d_fullres 0 -p nnUNetResEncUNetMPlans --npz
```

After about five epochs, note the epoch time and multiply by 1000: that is the
finishing time. Check `progress.png` once or twice a day.

*Decision points:*

| If | Then | Record |
|---|---|---|
| "CUDA out of memory" | Re-plan with `-gpu_memory_target 8` (ai-plan.md) and train those plans | The error, the new patch and batch size |
| 1000 epochs would take more than about three days | Train `-tr nnUNetTrainer_250epochs` instead: a quarter of the time, usually a little less accurate | Your estimate, the choice and why |
| The GPU often sits idle | Data on `/mnt/c`, or too few CPU workers or too little RAM: move the data, or set `nnUNet_n_proc_DA` | What you saw and what fixed it |
| It stops (crash, restart) | Run the same command with `--c` | When and why |

*Diary:* epoch time, the finishing estimate, train and validation loss and the
two pseudo-Dice values (kidney, tumour) every day or so.

**While it trains:** read nnU-Net's training loop (`nnUNetTrainer.train_step`)
next to the lesson on the techniques it uses; write or review `ctrr evaluate`
(step E); draft the parts of the model card that need no numbers; practise
coding problems.

### E. `ctrr evaluate`: scoring like a radiologist

nnU-Net's own `nnUNetv2_evaluate_folder` reports Dice per class. A reader cares
about lesions, so the model card also needs, for each held-out patient:

- every reference tumour, found or missed; every predicted tumour on nothing (false positive);
- found and missed by size: under 2 cm, 2–4 cm, over 4 cm (long axis);
- the long-axis error of each found tumour, measured the same way as `findings.py`.

**Decide:** write it yourself with guidance (best for learning, and the kind of
code AI roles ask about), or have Claude write it while you review. Either
way it is tested on the phantom before it touches the test set.

### F. Freeze, then test once (an hour)

When training ends, read fold 0's validation result
(`fold_0/validation/summary.json`) and `progress.png`. This is the last point
at which anything may change. Write in the diary: "Settings frozen", with the
date.

Then, once:

```bash
nnUNetv2_predict -i $nnUNet_raw/Dataset501_C4KCKiTS/imagesTs -o ~/nnunet/test-pred \
  -d 501 -c 3d_fullres -f 0 -p nnUNetResEncUNetMPlans
```

Score it with `nnUNetv2_evaluate_folder` (training.md, with `M` for `L`) and
`ctrr evaluate`. Copy the numbers into the diary as they come out, good or bad.

### G. The model card (half a day)

`docs/model-card.md`, in plain language:

1. **What it is**: nnU-Net v2, 3D full resolution, ResEnc M, fold 0, trained from scratch.
2. **What it is for**: a second reader in a teaching tool; never clinical use.
3. **Data**: C4KC-KiTS, 136 training and 34 validation patients; licence and credit.
4. **How it was trained**: settings from the plans, epochs, hardware, time.
5. **Results on the 40 held-out patients**: Dice for kidney and tumour;
   tumours found and false positives per scan, by size; long-axis error.
6. **Where it fails**: the worst cases with images; every patient had a tumour;
   no cysts in training; contrast CT from one centre only.
7. **How it is used on the site**: after hand-in, never on a patient it trained on.

### H. On the site (an hour)

```bash
uv run ctrr model-json --run <nnUNet results folder> --out model.json    # to build
uv run ctrr ai-input kits-00002 kits-00003 kits-00004 kits-00006 kits-00007
nnUNetv2_predict -i .data/ai-input -o .data/ai-output -d 501 -c 3d_fullres -f 0 -p nnUNetResEncUNetMPlans
uv run ctrr ai kits-00002 --prediction .data/ai-output/kits-00002.nii.gz --model model.json
cd ../web && pnpm upload-cases
```

`ctrr ai` for each case. The site cases are test patients, so they were
already scored in step F; this only puts the read on the site. Then read each
case on the live site, hand in, and check the AI's layer.

## After phase 1

The diary becomes the backbone of the walkthrough (roadmap, phase 5), and the
model card is linked from the site's AI panel.
