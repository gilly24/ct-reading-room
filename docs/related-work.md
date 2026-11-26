# Related work

What already exists, so this project adds something instead of repeating it.
From about a dozen targeted searches in November 2026: a map, not a systematic
review. Before claiming novelty in a paper, search PubMed and arXiv properly,
ideally with a librarian or supervisor.

## Kidney tumour segmentation: crowded

- **KiTS19, KiTS21, KiTS23.** Three rounds of the kidney tumour challenge.
  KiTS19 was won by nnU-Net. KiTS23 was won by NVIDIA's team with MONAI
  Auto3DSeg (a SegResNet and DiNTS ensemble, average Dice 0.835); second place
  used nnU-Net's preprocessing and 3D U-Nets (0.820).
- **nnU-Net Revisited (MICCAI 2024).** The same splits and protocol for every
  model, from scratch, five-fold cross-validation. On KiTS23 (489 cases):
  original nnU-Net 86.0 Dice, ResEnc M 86.8, ResEnc L 88.2, MedNeXt L 88.3,
  Auto3DSeg SegResNet 81.1, SwinUNETR 81.3. Its point: rigorous validation, not
  new architectures, decides results.

*For us:* another kidney model is not a contribution. It is a component, and
nnU-Net ResEnc M is the strongest that fits a 10–12 GB GPU.

## From outlines to reports: crowded

- **RadGPT / AbdomenAtlas 3.0 (ICCV 2025).** 9,262 CTs with masks and reports
  for liver, kidney and pancreatic tumours. Tumour outlines become structured
  reports through deterministic rules (size, location, attenuation,
  resectability), then a language model writes narrative reports.
- **Merlin (Stanford; Nature 2026).** A 3D CT vision-language model pretrained
  on 15,331 abdominal CTs with their reports and diagnosis codes; generates
  reports among 752 tasks. Coverage notes its reports tend to under-report
  positive findings.
- **Astra, MARCH (2026).** A report-generation foundation model for 3D CT, and
  a multi-agent CT report generator.
- **Non-contrast abdominal CT benchmark (MICCAI 2026).** Disease classification
  and report generation from non-contrast CT, 1,254 patients across two centres.

*For us:* do not build a report-writing model. Draft from measurements, and
make the draft honest about its scope (below).

## Checking the numbers in AI reports: started, mostly chest X-ray

- **FactCheXcker (CVPR 2025).** Finds measurement statements in generated chest
  X-ray reports, recomputes them from the image and corrects them.
- **Sentence-level verifiers (2025).** Process reward models and post-hoc
  visual checks that flag hallucinated sentences in generated reports.

*For us:* our drafter only writes measured numbers, and a checker refuses
anything else. An abdominal CT version of this, with an explicit statement of
what was not assessed, was not found.

## Saying what the AI did not assess: no standard found

No guidance or study was found on how an AI report should disclose its scope.
Related points: a model that looks for a fixed list of findings is silent on
everything else, and silence is not the same as "normal"; review guidance warns
when important differentials are not assessed.

*For us:* every organ line in the AI's report is either a measurement or "Not
assessed by the AI" (report-format.md).

## Training tools: commercial, or chest X-ray

- **Navigating Radiology, CaseStacks.** Commercial case platforms with feedback
  on reads and reports, including AI feedback.
- **RadGame (ML4H 2025).** A gamified platform on chest X-rays: localise
  findings against reference boxes, write reports scored by a language model.
  18 medical students improved localisation by 68% against 17% with passive
  study.

*For us:* no open-source CT tool was found that scores a learner's read against
an expert reference and an AI. The closest match a search returned was this
repository.

## When to show the AI: mostly mammography

- **AI-first against AI-second (European Radiology).** Six breast radiologists,
  200 mammograms. With AI shown first, readers followed wrong advice in 36% of
  manipulated cases; shown after their own call, 34% changed a right answer to
  a wrong one. Saliency maps halved both; junior readers were most affected.
- **Radiology (2026).** Ten breast radiologists: when the AI missed a cancer,
  their sensitivity fell to 39% with AI against 71% without.
- **Reviews.** Second-reader timing is recommended to reduce automation bias
  and for training, but the recommendation is largely untested in learners.

*For us:* the open question is the same timing question for learners on CT,
with measurements as well as detection (study-plan.md).

## Measuring with AI help

- **A multicentre RECIST study.** 23 readers, 8 of them residents. AI-proposed
  measurements made lesion-level variability larger (+1.3 mm) than expert
  proposals, though patient-level response agreement improved.
- **No study was found** testing whether feedback against a reference
  segmentation improves trainees' measurements over a series of cases.

*For us:* the site already gives per-lesion size error after every read; the
study can measure whether it helps.

## Sources

- [nnU-Net Revisited (arXiv 2404.09556)](https://arxiv.org/abs/2404.09556) and [the ResEnc results table](https://github.com/MIC-DKFZ/nnUNet/blob/master/documentation/resenc_presets.md)
- [KiTS23 winning solution, NVIDIA (arXiv 2310.04110)](https://arxiv.org/abs/2310.04110v1); [second place (arXiv 2312.05528)](https://arxiv.org/html/2312.05528v1); [KiTS23 overview](https://link.springer.com/chapter/10.1007/978-3-031-54806-2_1); [KiTS23 data and licence](https://github.com/neheller/kits23)
- [RadGPT (arXiv 2501.04678)](https://arxiv.org/html/2501.04678v2)
- [Merlin (arXiv 2406.06512)](https://arxiv.org/abs/2406.06512); [coverage of the Nature paper](https://www.auntminnie.com/clinical-news/ct/article/15818808/ai-model-shows-promise-for-reading-ct-scans-like-a-radiologist-would)
- [Astra (arXiv 2605.31437)](https://arxiv.org/pdf/2605.31437); [MARCH (arXiv 2604.16175)](https://arxiv.org/pdf/2604.16175)
- [Non-contrast abdominal CT benchmark (arXiv 2606.16991)](https://arxiv.org/abs/2606.16991)
- [FactCheXcker (CVPR 2025)](https://openaccess.thecvf.com/content/CVPR2025/html/Heiman_FactCheXcker_Mitigating_Measurement_Hallucinations_in_Chest_X-ray_Report_Generation_Models_CVPR_2025_paper.html); [process reward verifiers (arXiv 2510.23217)](https://arxiv.org/pdf/2510.23217)
- [RadGame (arXiv 2509.13270)](https://arxiv.org/abs/2509.13270); [Navigating Radiology](https://www.navigatingradiology.com/); [CaseStacks](https://casestacks.com/)
- [AI-first against AI-second (AuntMinnie Europe)](https://www.auntminnieeurope.com/clinical-news/womens-imaging/article/15826533/ai-can-mislead-radiologists-and-make-the-error-more-persuasive); [Radiology 2026](https://pubs.rsna.org/doi/10.1148/radiol.252590); [human–AI interaction review](https://dirjournal.org/article/10.4274/dir.2026.263780)
- [AI-assisted RECIST measurement](https://healthmanagement.org/c/imaging/news/ai-speeds-cancer-lesion-measurement-but-needs-oversight); [RECIST variability review](https://pmc.ncbi.nlm.nih.gov/articles/PMC11306910/)
- [European Radiology guide for reviewing AI papers](https://journals.myesr.org/eur-radiol/guide-for-reviewing-ai-papers/)
- [TotalSegmentator](https://github.com/wasserth/TotalSegmentator)
