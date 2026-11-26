# Roadmap

The plan to finish the project: about 12 weeks full-time from the end of
November 2026, with a break over Christmas. Why it is shaped this way is in
project.md. Each phase ends with something that works on its own, and each says
what it shows an employer.

Week 1 starts on Monday 30 November 2026. The dates are a guide; the order matters more.

## Done so far

- [x] Pipeline: CT DICOM + DICOM SEG → case bundle, geometry checks, RECIST-style measurements
- [x] Synthetic phantom with known answers, used as the tutorial and test fixture
- [x] C4KC-KiTS from the Imaging Data Commons, served from Cloudflare R2
- [x] Lossless HTJ2K (2.5–3× smaller); the first image shows before the rest arrive
- [x] Viewer: axial, coronal and sagittal with crosshair lines that move them;
      PACS mouse controls; window presets; length tool; orientation letters
      and a figure in each view; phone layout
- [x] Simulator: hand in, score (found, false positives, size error, time),
      reference outlines and measurements, report drafted from measurements
- [x] Training data: `ctrr train-data` checked all 210 C4KC-KiTS studies (all
      passed) and wrote the nnU-Net dataset; a fixed split holds out 40
      patients, every website case among them (training.md)
- [x] AI plumbing: `ctrr ai-input` and `ctrr ai` (measured by `findings.py`,
      refuses trained patients, DICOM SEG out); on the site after hand-in, the
      AI's layer, score, findings and report
- [x] Plan: project.md, related-work.md, ai-plan.md, report-format.md, study-plan.md

## Phase 0: now

- [ ] Merge the pull request so the three-view viewer is live (the AI layer
      waits for a real model).

## Phase 1: the kidney model (weeks 1–3)

Step by step, with checks and decision points: [phase1.md](phase1.md). Record
it in [training-diary.md](training-diary.md).

**Week 1**
- [ ] Meet the supervisor; start the ethics application (study-plan.md).
- [ ] Training machine: `nvidia-smi`, WSL2 if on Windows, PyTorch with CUDA, nnU-Net v2.
- [ ] Fetch the 210 studies there and run `ctrr train-data` (or copy the 12 GB
      of NIfTI it wrote); compare its `validation.md` with training.md's result.
- [ ] Plan and preprocess, copy `splits_final.json`, start fold 0: ResEnc M on
      the 3080, or ResEnc L on a rented GPU (training.md).
- [ ] `model.json` with the 170 training patients as `trainedOn`.

**Week 2**, while it trains
- [ ] Report drafter reworked to the template (report-format.md), with the checker. Tested on the phantom.

**Week 3**
- [ ] Predict the test group and the site cases. `ctrr evaluate`.
- [ ] `docs/model-card.md`, first version, from the test group only.
- [ ] `ctrr ai` on the site cases; upload; the AI is live after hand-in.

*Done when* a visitor sees a real model's read after hand-in, and the model
card's numbers come from patients it never saw.
*Shows:* training under a GPU budget, leak-free splits, honest evaluation.

## Phase 2: the honest report (weeks 4–6)

- [ ] TotalSegmentator ("total" task) on the site cases; an `anatomy` entry in
      the case format (bundle.py, types.ts, case-format.md together).
- [ ] The AI's report: organ lines measured or "Not assessed by the AI"; organ
      names checked against anatomy.
- [ ] "Report with AI": the AI's findings pre-filled; the reader accepts or
      rejects each one, and their report is drafted from what they kept.
- [ ] DICOM SR (TID 1500) for the AI's measurements, next to the SEG.
- [ ] Cases without a kidney mass for the study, from a source the supervisor
      agrees, checked by a radiologist; held out from the model.

*Done when* the AI's report never states a number it did not measure, never
calls anything normal, and says what it did not assess, with a test for each.
*Shows:* safety by design, integrating an existing model, PACS formats.

## Christmas break (one week, between phases 2 and 3)

## Phase 3: the study mode (weeks 7–8)

- [ ] A separate study entry: participant code, consent screen, randomised
      AI-first and AI-after blocks, reads stored in the project's own storage.
      The public site still records nothing.
- [ ] Pilot with two or three people from the research team (no participant data).
- [ ] Fix what the pilot shows.

*Done when* the supervisor has tried it and the ethics application has everything it asks for.
*Shows:* building for real users, privacy and consent, a backend on Cloudflare.

## Phase 4: run the study (weeks 9–11, once approved)

- [ ] Recruit and run the sessions.
- [ ] Analysis with the supervisor: detection, false positives, measurement
      error, following the AI when it is wrong, AI-first against AI-after.

If approval is not through by week 9, this phase moves later. Use the time for
the "if time allows" items in ai-plan.md and polish, and run the study when it
is approved.

*Shows:* a research question answered end to end.

## Phase 5: show it (week 12)

- [ ] **Live site**: every page works on desktop and phone; README with the
      new screenshot and one paragraph on what it is.
- [ ] **Demo video**, 2–3 minutes: read a case in the three views, measure,
      hand in, see the reference and the AI, open the honest report, and say
      what the study found.
- [ ] **Written walkthrough** (`docs/walkthrough.md`): the problem, what
      exists already, what was built and why, the model's results and limits,
      the study's results, what you would do next.
- [ ] CV and LinkedIn: three lines, with links to the site, the video and the repository.

## Later (optional)

- A software paper in the Journal of Open Source Software.
- The study as a conference abstract or poster.
- The model and model card on Hugging Face (C4KC-KiTS is CC BY 3.0; KiTS23 would make it non-commercial).
- Auto3DSeg SegResNet trained to fit the 3080 and compared with nnU-Net.
- Liver and pancreas lesions (AbdomenAtlas 3.0, licence to check).
- Compare with a prior scan (Longitudinal-CT): lesions matched, growth measured.
- Report prose from an open language model, held to the same checker.
- Remember a reader's attempts in the browser; keyboard help overlay (`?`).
