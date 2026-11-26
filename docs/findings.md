# Findings so far

What the project has learned up to 26 November 2026: about the field, about
the data, and from building the site. Decisions and their reasons are in
[project.md](project.md); the plan is [roadmap.md](roadmap.md).

## Summary

- **The reading room works and is live**: three-view CT in the browser, PACS
  mouse controls, measuring, a drafted report, and scoring against the
  radiologists' outlines after hand-in.
- **The AI second reader is ready except for the model**: its training data is
  built and checked, and the code that measures its outlines, keeps it away
  from patients it trained on, and shows its read after hand-in is built and
  tested. Training on an RTX 3080 is next.
- **A better kidney model would not be new.** The field has three rounds of a
  kidney tumour challenge and several systems that already turn outlines into
  reports. The open gaps are on the human side: an open CT training tool that
  scores a learner against a reference and an AI, an AI report that says what
  it did not check, and how learners use AI on CT.
- **nnU-Net is the right model for this hardware**, despite NVIDIA's model
  winning the latest challenge: in a like-for-like comparison it scored higher
  on kidney CT and fits a 10–12 GB GPU.
- **Several engineering problems were found and fixed** along the way, the most
  important being AI input files that would have reached the model upside down.

## What exists

| Part | State |
|---|---|
| Viewer | Live. Axial, coronal and sagittal; crosshair lines that move the other views; drag to scroll, right-drag to window, right-click menu; orientation letters and a figure in each view; phones get one view at a time |
| Cases | Live. The synthetic tutorial and five C4KC-KiTS kidney cases, served from Cloudflare R2 as lossless HTJ2K |
| Scoring and report | Live. Tumours found, false positives, size error, time; a report drafted from measurements, the impression left to the reader |
| Training data | Built. 210 C4KC-KiTS patients checked, all passed; 170 to train, 40 held out, every site case among the 40 (training.md) |
| AI step | Built and tested, waiting for a model. `ctrr ai-input`, `ctrr ai`, `ai.json`, DICOM SEG, the AI layer and its score after hand-in |
| Tests | 43 pipeline, 34 web, run on every pull request with a Cloudflare deploy dry run |
| Plan | project.md, roadmap.md, ai-plan.md, report-format.md, study-plan.md, related-work.md |

## What the research showed

From about a dozen targeted searches (related-work.md has the sources). A map,
not a systematic review.

**The model race is crowded.**
- KiTS19, KiTS21 and KiTS23 are three rounds of a kidney tumour challenge.
  KiTS19 was won by nnU-Net. KiTS23 was won by NVIDIA's MONAI Auto3DSeg
  (SegResNet and DiNTS together, Dice 0.835), with an nnU-Net-based entry second
  (0.820).
- RadGPT (ICCV 2025) turns tumour outlines on 9,262 CTs into structured and
  narrative reports for liver, kidney and pancreas. Stanford's Merlin (Nature
  2026), trained on 15,331 abdominal CTs with their reports, generates reports
  among hundreds of tasks.

**The gaps are on the human side.**
- No open-source CT training tool was found that scores a learner's read
  against an expert reference and against an AI. Commercial platforms exist,
  and RadGame does this for chest X-rays.
- No standard was found for an AI report saying what it did not assess.
  FactCheXcker (CVPR 2025) corrects made-up measurements, but in chest X-ray
  reports.
- When readers see the AI before their own call, they follow wrong advice
  (36% of manipulated cases in one mammography study); after it, they change
  right answers (34%). Saliency maps halved both. Almost nothing tests this for
  learners, for CT, or for measurements.
- In a 23-reader RECIST study, AI-proposed measurements made lesion-level
  variability larger (+1.3 mm) than expert proposals.

**Which model.** The fairest comparison found was nnU-Net Revisited (MICCAI
2024): every model trained the same way, five-fold cross-validation, on KiTS23's
489 cases.

| Model | Kidney CT Dice | GPU memory |
|---|---|---|
| nnU-Net ResEnc M (our choice) | 86.8 | 9.1 GB |
| nnU-Net ResEnc L | 88.2 | 22.7 GB |
| MedNeXt L | 88.3 | 17.3 GB |
| Auto3DSeg SegResNet | 81.1 | 20.0 GB |
| SwinUNETR (transformer) | 81.3 | 13.1 GB |

NVIDIA won the challenge with expert tuning and an ensemble; trained the same
way as the rest, SegResNet scored lower. ResEnc M is the strongest that fits the
project's RTX 3080. The authors ran this comparison on their own framework,
which is worth remembering.

## What the data showed

**C4KC-KiTS**, the 210 patients the model trains on (training.md has the full result):

- Every case passed every check: one SEG and one CT series, matching headers,
  evenly spaced slices, no gantry tilt, outlines exactly on their images.
- Slices per series range from 29 to 1,059 (median 107); slice spacing from
  0.5 to 5 mm. nnU-Net resamples them all to one spacing.
- **Every patient has a kidney tumour** (they all had one removed), and **no cyst
  is outlined**. So the model will rarely have seen a normal kidney, and cannot
  tell a cyst from a mass. Its report will say cysts were not assessed.
- 47 cases have values below −1024 HU (outside the scanned circle), 7 have
  metal above 3071 HU, and one is rotated 4° in-plane. None matters to training.

**The site's cases** have very different slice spacing, which decides how the
side views look: 1 mm for kits-00002 and -00003 (sharp coronal and sagittal),
3 mm for -00006 and -00007, 4 mm for -00004 and the phantom (blocky).

**Storage.** Lossless HTJ2K makes the CT 2.5–3 times smaller (kits-00002: 138 MB
to 47 MB) without changing a single pixel value, checked with a second decoder.

## What building it taught

Problems found along the way, each now fixed or recorded. They are the kind of
detail that decides whether medical imaging software can be trusted.

- **AI input upside down.** The training data was written head first and the AI
  input feet first. Both describe the same body, but nnU-Net takes the array as
  it is, so the model would have read every case upside down. Found while
  merging; both now go through the same code, and a test checks they match.
- **Mouse buttons that kept old jobs.** Cornerstone adds to a tool's mouse
  bindings instead of replacing them, so choosing Zoom after Pan left the left
  button panning. Every tool's bindings are now cleared before new ones are set.
- **A false warning.** Cornerstone 5.17 refreshed a view's record of loaded
  images just before recording the last one, so fully loaded side views said
  "Low Fidelity". All slices were there; one more change notice clears it.
- **Building the 3D views cheaply.** Cornerstone needs only the first, middle and
  last image to place the volume, and the views share the image cache with the
  axial view, so the first image still appears quickly and nothing downloads
  twice. Cornerstone also reorders the image list it is given in place, so it
  gets a copy.
- **A click held for 400 ms.** Cornerstone waits to see whether a click becomes
  a double-click; choosing Measure inside that window can start a line at the
  earlier click. Rare in real use, and from Cornerstone itself; recorded, not changed.
- **Cloudflare branch builds failed on every pull request** while `main` deployed
  fine. The log was not reachable from here. Each pull request is now checked on
  GitHub with the same deploy, dry-run, and the branch builds are being turned off.
- **The viewer did not resize** with the window; it now follows its container.

## Open questions

| Question | Who decides |
|---|---|
| Add KiTS23 so the AI can tell cysts from masses (non-commercial licence, overlapping patients)? | The author (project.md, #14) |
| The study: committee, participants, sample size, data storage | The supervisor and the ethics committee (study-plan.md) |
| Cases without a kidney tumour for the study, and who checks them | The supervisor, with a radiologist |
| The 3080's memory: 10 or 12 GB, which decides the training settings | `nvidia-smi` on the training PC |
| Why Cloudflare's branch builds failed | Only the Cloudflare build log shows it; no longer blocking |

## Next

Phase 1 of the roadmap: train nnU-Net ResEnc M on the 3080, evaluate it once on
the 40 held-out patients, write the model card, and put its read on the site.
In parallel, the report drafter in the template (report-format.md) with its
checker, and the ethics application with a supervisor.
