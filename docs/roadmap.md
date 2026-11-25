# Roadmap

Each milestone ends with something that works on its own and is worth showing.

## 1. Reading room — done

- [x] Pipeline: CT DICOM + DICOM SEG → case bundle, geometry checks, RECIST-style measurements
- [x] Synthetic phantom with known answers, used as tutorial and test fixture
- [x] C4KC-KiTS fetch from Imaging Data Commons
- [x] Browser DICOM viewer: scroll, window presets, pan, zoom, length tool, R/L markers
- [x] Simulator: hand in, score (found, false positives, size error, time), reference outlines and measurements
- [x] Report drafted from measurements, impression left to the reader
- [x] Works at phone width

## 2. AI second reader

The AI reads the same case and its findings appear as a third layer, beside the
reader's and the reference.

- [ ] Train nnU-Net v2 (ResEnc preset) on KiTS (kidney + tumour). Hold out whole
      cases; never test on a case it trained on.
- [ ] `ctrr ai`: run the model on a case, measure its output with the same
      `findings.py`, write `ai.json` (same lesion shape as `truth.json`) and
      `ai-labels.u8.gz`.
- [ ] Also write the output as DICOM SEG (outlines) and DICOM SR (measurements)
      with highdicom, so it opens in any PACS viewer.
- [ ] Web: an "AI findings" toggle after hand-in, and a "Report with AI" mode
      where the AI's findings are pre-filled and the reader accepts or rejects
      each one.
- [ ] Score the AI like a reader, per case and overall (sensitivity, false
      positives per case, size error), on the model card.
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

- [ ] Compress the DICOM losslessly (HTJ2K) in the pipeline: 2–3× smaller
      downloads. The decoders are already bundled.
- [ ] Load the slices near the current one first, so a big case opens sooner.
- [ ] Remember a reader's attempts in the browser (localStorage) and show progress across cases.
- [ ] Coronal and sagittal views (Cornerstone volume viewports).
- [ ] Keyboard help overlay (`?`).
