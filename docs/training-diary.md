# Training diary

A dated record of training the kidney model ([phase1.md](phase1.md)): what was
done, the settings and numbers, what went wrong and how it was fixed. It is
written as it happens, not tidied afterwards: the problems and fixes are the
useful part.

## How to write an entry

Copy this, newest at the bottom:

```markdown
### YYYY-MM-DD · step letter · one-line summary

- **Did:** the commands run or the change made
- **Settings / numbers:** versions, plans, epoch time, losses, Dice, anything measured
- **Problem:** what went wrong, with the exact error if there was one
- **Fix:** what fixed it, and how you know
- **Learned:** one sentence
```

## Entries

### 2026-11-26 · plan · Phase 1 planned

- **Did:** chose the data, split, model and hardware (project.md, decisions 4–6 and 13)
- **Settings / numbers:** C4KC-KiTS, 210 patients checked (all passed); split
  170 train / 40 test, fold 0 = 136 train / 34 validation; nnU-Net v2 ResEnc M,
  3d_fullres; RTX 3080
- **Problem:** the AI's input files were written feet first while the training
  data is head first; nnU-Net would have read every case upside down
- **Fix:** both now go through `train_data.ct_geometry`, and a test checks the
  input matches the training format
- **Learned:** nnU-Net uses arrays exactly as written, so orientation has to be
  identical in training and prediction
