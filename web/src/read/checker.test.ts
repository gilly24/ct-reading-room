import { describe, expect, it } from "vitest";
import { checkDraft } from "./checker";
import { lesions, meta } from "./fixtures";
import { draftReport, itemFromLesion } from "./report";
import { outliningSource } from "./template";

// A good draft of the AI's read (a 20 × 18 mm mass at the left lower pole,
// image 11 of 40), then one rule broken at a time.
const items = [itemFromLesion(lesions[0])];
const source = outliningSource("ai", ["kidney", "tumour"]);
const good = draftReport(meta, items, source).text;

const reasons = (text: string) => checkDraft(text, meta, items, source).map((p) => p.reason);
function edit(find: string, replace: string): string {
  expect(good).toContain(find);
  return good.replace(find, replace);
}

describe("checkDraft", () => {
  it("passes the drafter's own draft", () => {
    expect(reasons(good)).toEqual([]);
  });

  it("refuses a number that is not in the findings", () => {
    expect(reasons(edit("20 × 18 mm", "21 × 18 mm"))).toContain("the number 21 is not in this organ's findings");
    expect(reasons(edit("Volume 3.4", "Volume 3.5"))).toContain("the number 3.5 is not in this organ's findings");
    expect(reasons(edit("40 axial images", "41 axial images"))).toContain("the number 41 is not in the findings");
  });

  it("refuses a finding moved to another organ's line", () => {
    const moved = edit("Right kidney: No mass outlined by the AI.", "Right kidney: 20 mm mass (image 11 of 40).");
    expect(reasons(moved)).toEqual(
      expect.arrayContaining(["the number 20 is not in this organ's findings", "the number 11 is not in this organ's findings"]),
    );
  });

  it("refuses a side, position or organ the findings do not have", () => {
    expect(reasons(edit("at the lower pole", "at the lower pole, right of midline"))).toContain(
      "says right, which no finding here is",
    );
    expect(reasons(edit("at the lower pole", "at the upper pole"))).toContain(
      "names the upper pole, where no finding here is",
    );
    expect(reasons(edit("at the lower pole", "at the lower pole, abutting the liver"))).toContain(
      "names the liver, which no finding here is in",
    );
  });

  it("refuses diagnosis, likelihood, advice and 'normal'", () => {
    const interpreted = edit("Cysts not assessed.\nLymph", "Likely renal cell carcinoma.\nLymph");
    expect(reasons(interpreted)).toEqual(
      expect.arrayContaining(['names a diagnosis ("carcinoma")', 'says how likely something is ("Likely")']),
    );
    expect(reasons(edit("Bones: Not assessed by the AI.", "Bones: Further evaluation with ultrasound."))).toEqual(
      expect.arrayContaining(['gives advice ("Further evaluation")']),
    );
    expect(reasons(edit("Liver: Not assessed by the AI.", "Liver: Unremarkable."))).toContain(
      'calls something normal or abnormal ("Unremarkable")',
    );
  });

  it("refuses 'nothing found' about an organ the source did not assess", () => {
    expect(reasons(edit("Liver: Not assessed by the AI.", "Liver: No mass outlined by the AI."))).toContain(
      "says something is not there, in an organ that was not assessed",
    );
    // The kidneys were assessed, so the same sentence is allowed there (it is in the good draft).
    expect(good).toContain("Right kidney: No mass outlined by the AI.");
  });

  it("refuses a conclusion written for the radiologist", () => {
    expect(reasons(edit("CONCLUSION: [For the radiologist to complete.]", "CONCLUSION: Left kidney mass."))).toContain(
      "the conclusion is the radiologist's to write",
    );
  });

  it("refuses a finding left out, an organ line the template does not have, and a changed layout", () => {
    expect(reasons(good.replace(/^Left kidney: .*\n/m, ""))).toContain("leaves out the finding on image 11 (Left kidney)");
    expect(reasons(edit("Bones:", "Adrenals: Not assessed by the AI.\nBones:"))).toContain(
      '"Adrenals" is not an organ line of the template',
    );
    expect(reasons(edit("Bones:", "Liver: Not assessed by the AI.\nBones:"))).toContain("Liver has more than one line");
    expect(reasons(edit("CT ABDOMEN WITH", "MRI ABDOMEN WITH"))).toContain("the title is not this case's");
    expect(reasons(edit("COMPARISON: None.\n", ""))).toContain("the COMPARISON section is missing");
  });
});
