# Report format

The drafted report follows the author's template for CT abdomen and pelvis:
CLINICAL HISTORY, COMPARISON, TECHNIQUE, FINDINGS organ by organ, CONCLUSION.
Three drafts use it: the reader's own (from their measurements), the
reference's and the AI's (from their outlines).

Implementation, in `web/src/read/`:

| File | Does |
|---|---|
| `template.ts` | The template: sections, organ lines, number formats, and what each source may say |
| `report.ts` | The drafter: findings in, a draft out, checked before it is returned |
| `checker.ts` | The checker: refuses a draft that breaks a rule below |

The drafter and the checker both read `template.ts`, so they cannot disagree
about a heading or how a number is written. Every draft comes back with the
checker's verdict; the site shows a refused draft's reasons, never the draft.

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
2. **Assessed, nothing outlined**: only for what the AI was built to check.
   `Right kidney: No mass outlined by the AI.`
   The kidney model is trained on masses, not cysts, so its kidney lines also
   say `Cysts not assessed.`
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
Right kidney: No mass outlined by the AI. Cysts not assessed.
Left kidney: 48 × 39 mm mass at the lower pole (image 173 of 261). Mean attenuation 47 HU. Volume 35.0 cm³. Cysts not assessed.
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

A finding that fits no organ line (an organ the template does not name, or a
kidney lesion with no side) goes on an extra `Other:` line after Bones. On the
spleen, pancreas and adrenal line the organ is named: `14 mm cyst in the pancreas`.
If the case's description names no phase, the title is `CT ABDOMEN` and the
technique leaves the phase out; with no slice thickness, it leaves that out.

## What a source assessed

Only an organ line the source assessed may say nothing was found there. A
source that outlines classes assessed, for each lesion class it outlines, every
organ line whose organs it all outlines (`outliningSource` in template.ts):

- **The AI**: `model.outlines` in ai.json, every class the model can output
  (case-format.md). A kidney model outlining kidney and tumour assessed both
  kidneys for masses, so its kidney lines say `No mass outlined by the AI.` and
  `Cysts not assessed.` The spleen, pancreas and adrenal line needs all three
  organs outlined, so a model outlining only the spleen does not assess it.
- **The reference**: the classes in its label volume. C4KC-KiTS outlines kidneys
  and tumours, so cysts are `not assessed`; the phantom also outlines cysts and
  the liver. Its unassessed lines say `Not outlined in the reference.`
- **The reader** is assessed nowhere by the drafter: the reader decides what
  they looked at and writes it.

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
which is why the conclusion is always left blank.

How `checker.ts` applies them: it reads the text, not the drafter's intent, so
it can hold a language model's prose (milestone 3) to the same rules.

- Each findings line must be one of the template's organ lines (or `Other`),
  once. Its numbers must be its own findings' numbers, written as the drafter
  writes them; its side, pole and organ words must be its own findings'. A
  finding moved to another organ's line is refused.
- Every finding must appear on its line: a dropped finding is refused too.
- "No …", "without", "absent" and the like only on a line the source assessed.
- Outside the findings, the only numbers are the case's image count and slice
  thickness; the title must be the case's, every section present, and the
  conclusion exactly `[For the radiologist to complete.]`.

`checker.test.ts` starts from a good draft and breaks one rule at a time.
