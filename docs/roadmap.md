# Roadmap

Each milestone ends with something that works on its own and is worth showing.

## 1. Reading room — done

- [x] Pipeline: CT DICOM + DICOM SEG → case bundle, geometry checks, RECIST-style measurements
- [x] Synthetic phantom with known answers, used as tutorial and test fixture
- [x] C4KC-KiTS fetch from Imaging Data Commons
- [x] Browser DICOM viewer: scroll, window presets, pan, zoom, length tool, orientation markers
- [x] Simulator: hand in, score (found, false positives, size error, time), reference outlines and measurements
- [x] Report drafted from measurements, impression left to the reader
- [x] Works at phone width

## 2. AI second reader

The AI reads the same case and its findings appear as a third layer, beside the
reader's and the reference.

- [ ] Train nnU-Net v2 (ResEnc preset) on KiTS (kidney + tumour). Hold out whole
      cases; never test on a case it trained on.
- [x] `ctrr ai`: measure a model's output with the same `findings.py`, write
      `ai.json` (same lesion shape as `truth.json`) and `ai-labels.u8.gz`;
      refuse a patient the model trained on. `ctrr ai-input` writes the CT as
      NIfTI for nnU-Net.
- [x] Write the outlines as DICOM SEG with highdicom, so they open in any PACS.
- [ ] Also the measurements as DICOM SR (TID 1500).
- [x] Web: after hand-in, the AI's outlines and measurements as their own
      layer, with a toggle, its findings checked against the reference, and a
      report drafted from them.
- [ ] Web: a "Report with AI" mode where the AI's findings are pre-filled and
      the reader accepts or rejects each one.
- [x] Score the AI like a reader on each case, beside the reader's score.
- [ ] Score it overall (sensitivity, false positives per case, size error) on
      the held-out cases, for the model card.
- [ ] Model card (`docs/model-card.md`): data, intended use, where it fails.

## 3. Report drafting with a language model

- [ ] MedGemma (or another open model) turns the measured findings into report
      prose. It receives the measurements as JSON and never sees the scan.
- [ ] A checker refuses any draft containing a number, side or organ that the
      findings do not have.
- [ ] Impression still left to the reader.

## 4. More organs

- [ ] Liver and pancreas tumours from AbdomenAtlas 3.0 (check its licence for re-hosting).
- [ ] TotalSegmentator for organ and anatomy names on any case.

## 5. Compare with the prior scan

- [ ] Longitudinal-CT: baseline and follow-up side by side, lesions matched,
      "grown from 12 to 18 mm" drafted automatically.

## Site improvements

- [x] Compress the DICOM losslessly (HTJ2K) in the pipeline: 2.5–3× smaller
      downloads.
- [x] Load the slices near the current one first, so a big case opens sooner.
- [ ] Remember a reader's attempts in the browser (localStorage) and show progress across cases.
- [x] Coronal and sagittal views beside the axial one, with crosshair lines that move them,
      and PACS mouse controls (drag to scroll, right-drag to window, right-click menu).
- [ ] Keyboard help overlay (`?`).
