# Data

## Rules

1. **Public, de-identified datasets only.** Never a scan from a hospital, a
   clinic, a colleague or anywhere else, however anonymised it looks: names and
   IDs hide in DICOM headers and in text burned into the pixels.
2. **The licence must allow re-hosting.** CC BY does; "research use, do not
   redistribute" and click-through terms do not. If unsure, leave it out.
3. **Credit it where it is shown**: the case footer, the home page and the README.

## In use

### C4KC-KiTS (kidney tumours)

| | |
|---|---|
| What | 210 patients having a kidney tumour removed; CT with kidney and tumour outlines (DICOM SEG) |
| Licence | CC BY 3.0 |
| Cite | Heller N, Sathianathen N, Kalapara A, et al. Data from C4KC-KiTS. The Cancer Imaging Archive, 2019. https://doi.org/10.7937/TCIA.2019.IX49E8NX |
| Get it | `uv run ctrr fetch-kits` (NCI Imaging Data Commons, no account) |
| Outlines | semi-automatic, by the KiTS19 team; tumours are labelled "Mass" |
| Watch out | Cysts were not outlined, so a cyst a reader measures counts as a false positive (the answer panel says so). Each study has several phases; the SEG names the one it was drawn on, and only that one is downloaded. |

The CT files are 0.5–1 MB a slice, so a 260-slice case is about 130 MB. For
the website, prefer studies under about 100 slices (`--max-slices 100`) until
the DICOM is compressed (roadmap).

All 210 studies are also the AI's training data: 23.5 GB of outlined CT plus
3 GB of SEGs, split once into 170 training and 40 held-out patients
([training.md](training.md)). The website shows only held-out patients.

### Synthetic phantom

`pipeline/ctrr/phantom.py`. Nobody's scan; MIT like the code. It is the
tutorial case and the pipeline's test fixture.

## Next datasets (roadmap)

| dataset | why | licence to check |
|---|---|---|
| AbdomenAtlas 3.0 | 9,262 CTs with liver, kidney and pancreatic tumour masks and radiologist-written structured reports: training data for the AI and for its report drafting | check the RadGPT repository's terms before re-hosting any scan |
| Longitudinal-CT (Tübingen) | 300 melanoma patients, baseline and follow-up CT with matched lesions: "compare with prior" | check the record's licence |
| LUNA25 | 4,069 low-dose chest CTs with nodule annotations: a chest module | CC BY 4.0 (NLST) |

## Adding a dataset

1. Read its licence. Write it down in this file.
2. Add a fetcher next to `idc.py` that downloads the CT and its SEG into
   `pipeline/.data/raw/<patient>/`. If the outlines are not DICOM SEG (NIfTI is
   common), convert them in the fetcher: highdicom can write a SEG from a mask
   and the CT datasets, as `phantom.py` does.
3. If its segments have names `class_for_segment()` does not know, add them
   (and a test in `tests/test_findings.py`).
4. Give its cases an id prefix of their own and a `source` with dataset,
   licence, citation and URL. Run `uv run ctrr index`.
