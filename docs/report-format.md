# Report format

The drafted report follows the author's template for CT abdomen and pelvis:
CLINICAL HISTORY, COMPARISON, TECHNIQUE, FINDINGS organ by organ, CONCLUSION.
Two drafts use it: the reader's own (from their measurements) and the AI's
(from its outlines). Implementation: `web/src/read/report.ts`, to be reworked to
this layout (roadmap, phase 2).

## Sections, and where each comes from

| Section | Content | Source |
|---|---|---|
| Title | `CT ABDOMEN WITH IV CONTRAST (ARTERIAL PHASE)` | `case.json` description and phase |
| CLINICAL HISTORY | `Not provided (teaching case).` | Public datasets carry none |
| COMPARISON | `None.` | One scan per case |
| TECHNIQUE | Number of axial images, slice thickness, phase; `Coronal and sagittal reconstructions.` | `case.json` geometry |
| FINDINGS | One line per organ group, in the order below | Measurements only |
| CONCLUSION | `[For the radiologist to complete.]` | Always left for the person |

Organ groups, in the template's order: Liver · Spleen, pancreas and adrenal
glands · Right kidney · Left kidney · Lymph nodes · Bowel and appendix ·
Peritoneum (fluid, collections) · Lung bases · Bones.

## The three kinds of findings line

1. **Measured**: organ, side, position, size, image, and attenuation and
   volume when known.
   `Left kidney: 48 × 39 mm mass at the lower pole (image 173 of 261). Mean attenuation 47 HU. Volume 35.0 cm³.`
2. **Assessed, nothing outlined**: only for organs the AI was built to check.
   `Right kidney: No mass or cyst outlined by the AI.`
3. **Not assessed**: everything else.
   `Liver: Not assessed by the AI.`

The AI never writes "normal" or "unremarkable". Finding nothing it was trained
to find is not the same as finding nothing.

## Example: the AI's draft for a kidney case

```text
CT ABDOMEN WITH IV CONTRAST (ARTERIAL PHASE)

CLINICAL HISTORY: Not provided (teaching case).
COMPARISON: None.
TECHNIQUE: 261 axial images, 2 mm slices, arterial phase. Coronal and sagittal reconstructions.

FINDINGS:
Liver: Not assessed by the AI.
Spleen, pancreas and adrenal glands: Not assessed by the AI.
Right kidney: No mass or cyst outlined by the AI.
Left kidney: 48 × 39 mm mass at the lower pole (image 173 of 261). Mean attenuation 47 HU. Volume 35.0 cm³.
Lymph nodes: Not assessed by the AI.
Bowel and appendix: Not assessed by the AI.
Peritoneum: Not assessed by the AI.
Lung bases: Not assessed by the AI.
Bones: Not assessed by the AI.

CONCLUSION: [For the radiologist to complete.]

Draft from the AI's outlines. Check every measurement against the images.
```

With anatomy from TotalSegmentator (ai-plan.md), organ lines can also carry
measurements such as an organ's length, still as measurements, never "normal".

## The reader's own draft

The same layout. The reader's measurements fill the organ lines they belong to;
every other organ line shows `[Your findings]`, so the reader writes a whole
report, as the template does, rather than only the kidneys.

## Rules the checker enforces

Allowed: organ, side, position (pole), size, image number, attenuation in HU,
volume, count.

Refused, and the draft is not shown:

- a number, side, organ or position that is not in the findings it was drafted from;
- diagnosis words: carcinoma, malignant, benign, granuloma, haemorrhagic and the like;
- likelihood words: likely, suggestive of, consistent with, represents;
- advice: further evaluation, recommend, ultrasound, follow-up;
- "normal", "unremarkable", or a negative statement about an organ the AI did
  not assess.

The template's interpretive lines ("likely represents a haemorrhagic cyst",
"require further evaluation with ultrasound") are the radiologist's to write,
which is why the conclusion is always left blank. The drafter's existing test
already refuses diagnosis words; the checker extends that to every rule above.
