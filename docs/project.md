# The project

What CT Reading Room is for, what it will contain when it is finished, and the
decisions behind it. The week-by-week plan is [roadmap.md](roadmap.md); what
others have already done is [related-work.md](related-work.md).

## In one paragraph

An open, browser-based reading room for abdominal CT. A learner reads a real
scan the way a radiologist does: scrolls the axial, coronal and sagittal views,
measures what they find and drafts the report. Then the site shows them the
radiologists' outlines, their score, and an AI second reader's read of the same
scan, scored by the same rules. The AI never saw that patient while it trained,
its report says what it checked and what it did not, and every number in it is
a measurement of what it outlined. A small study then asks a question the field
has barely tested on CT: do learners do better when they see the AI before
their own read, or after it?

## Why this, and not a better model

A search of recent work (related-work.md) found the model race crowded: three
rounds of the KiTS kidney-tumour challenge, RadGPT turning tumour outlines into
structured reports for liver, kidney and pancreas, and Stanford's Merlin and
others generating whole abdominal CT reports. A student with one GPU will not
move those numbers.

The gaps are on the human side:

- No open-source CT training tool was found that scores a learner's read
  against an expert reference and against an AI.
- No standard was found for an AI report saying what it did not assess, and
  measurement checking has been built for chest X-ray reports, not abdominal CT.
- Evidence on showing AI before or after a reader's own call comes mostly from
  mammography, little from CT, from learners or from measurement.

So the contribution is an open tool, an honest AI second reader inside it, and
a small study of how learners use it. The AI model is a component, built well
and evaluated honestly, not the headline.

## What it will consist of

**1. The reading room (built).** Real public CT in a PACS-style viewer: three
views with crosshair lines, PACS mouse controls, window presets, a calibrated
length tool, a report drafted from the reader's measurements, and scoring
against the radiologists' outlines after hand-in. Served from Cloudflare,
lossless HTJ2K, first image in about a second. See architecture.md.

**2. An honest AI second reader.** [ai-plan.md](ai-plan.md) has the detail.
- *Kidney model:* nnU-Net v2, ResEnc M preset, trained on KiTS23 (kidney,
  tumour, cyst) on an RTX 3080, with every site case and a test group held out.
- *Anatomy:* TotalSegmentator's open "total" model names the organs, measures
  them, and decides which organs the AI's report can speak about.
- *The report:* the template in [report-format.md](report-format.md), organ by
  organ, each line either a measurement or "Not assessed by the AI". No
  interpretation; the conclusion is left for the reader. A checker refuses any
  number, side or organ that the measurements do not contain.
- *PACS formats:* outlines as DICOM SEG (built), measurements as DICOM SR.
- *Report with AI:* a mode where the AI's findings are pre-filled and the
  reader accepts or rejects each one.
- *Model card:* data, intended use, held-out results, where it fails.

**3. A learner study.** [study-plan.md](study-plan.md) is a draft protocol for
a supervisor and an ethics committee. Nothing is recorded on the public site;
a separate study mode runs only with approval and consent.

## What it is not

- A diagnostic tool. It shows a fixed set of public cases and never accepts a
  scan (safety.md).
- A claim to beat the state of the art. The model is judged on held-out cases
  and its limits are written down.
- Commercial. KiTS23's data is non-commercial (CC BY-NC-SA), so the model is too.

## Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Roles this should win | AI engineer and software engineer | The author's aim; the roadmap shows evidence for both |
| 2 | Contribution | Open tool + honest AI report + learner study | The model race is crowded; the human side is not (related-work.md) |
| 3 | Viewer | Three views, crosshair lines, PACS mouse (drag scrolls, right-drag windows, right-click menu), Sectra-like layout | How radiologists actually read; built and live |
| 4 | Model | nnU-Net v2, 3D full resolution, ResEnc M, fold 0 | Fits a 3080 (9.1 GB in the authors' runs). In their like-for-like comparison on KiTS23 it scored 86.8 Dice against 81.1 for Auto3DSeg SegResNet, though NVIDIA's tuned SegResNet ensemble won the KiTS23 challenge |
| 5 | Training data | KiTS23: kidney, tumour, cyst | Cysts are labelled, so the AI can make the mass-or-cyst call readers make; more cases than C4KC-KiTS |
| 6 | Held out | Every patient on the site, plus a test group fixed before training | A model scored on what it trained on proves nothing; `ctrr ai` enforces it |
| 7 | AI scope | Kidney (mass, cyst) + anatomy from TotalSegmentator | A focused model done properly, an honest checklist for the rest |
| 8 | Report | The author's template, measured or "not assessed", conclusion left blank | Safety (the drafter never diagnoses) and the scope-disclosure gap |
| 9 | When the AI appears | After hand-in, on the public site | Lower automation bias; the study tests before against after |
| 10 | Study | Learners, AI before vs after, real model output only, ethics approval and a supervisor | The open question the site is built to answer |
| 11 | What to show employers | Live site, demo video, written walkthrough | The author's choice; a paper and published weights can follow |
| 12 | Time | About 12 weeks full-time, plus a break over Christmas | The author's availability |
| 13 | GPU | The author's RTX 3080; memory and drivers checked with `nvidia-smi` | A 10 GB card fits ResEnc M; a 12 GB one has room to spare |

Record new decisions here with the reason, rather than changing old rows.

## What it shows an employer

| AI engineer | Software engineer |
|---|---|
| Data with licences checked, and splits that cannot leak (`ctrr ai` refuses trained patients) | A real DICOM viewer: Cornerstone3D, three views, crosshair geometry with unit tests (`viewer/mpr.ts`) |
| Training nnU-Net within a 10–12 GB budget, and knowing why it was chosen | Performance: lossless HTJ2K, first image before the rest arrive, a shared image cache |
| Evaluation a clinician would accept: per lesion, by size, on held-out cases, with a model card | Clean contracts: the case format, the pipeline, the site and their tests change together |
| Integrating an existing model (TotalSegmentator) instead of rebuilding it | Deployed: a Cloudflare Worker with R2, CI on every push |
| Medical formats: NIfTI for the model, DICOM SEG and SR for a PACS | Product sense: PACS conventions, phones, accessibility, a safe design |
| Safety by design: scope disclosure, measured numbers only, a human-factors study | Documentation a newcomer can follow |

**The story for an interview:** "I built an open CT reading room people can
learn in. When I looked at the research, the model race was crowded but no one
had an open tool that scores you against both the radiologists and an AI, so I
built the AI to be an honest second reader: it never sees its test patients,
it says what it did not check, and every number is a measurement. Then I ran a
small study on whether learners should see the AI before or after their own
read. Here is the live site, and here is what we found."

## Risks

| Risk | What we do |
|---|---|
| Ethics approval is slow; committees often pause over December and January | Apply in week 1. The study is the last phase, and everything else stands on its own |
| A 10 GB card runs out of memory | Plan with a lower memory target (ai-plan.md); fold 0 only |
| Training takes longer than planned | It resumes; other work runs while it trains |
| KiTS23 and C4KC-KiTS share patients | Match them before training, and hold out every site patient under both names |
| KiTS scans are all contrast CT, and every patient has a mass | Written on the model card. The study adds cases without kidney tumours |
| The model is weaker than hoped | It is still an honest second reader; its failures are the teaching material, and the model card says so |
