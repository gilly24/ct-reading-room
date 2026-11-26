import { describe, expect, it } from "vitest";
import phantomCase from "../../public/cases/phantom-01/case.json";
import phantomTruth from "../../public/cases/phantom-01/truth.json";
import type { CaseMeta, Truth } from "../case/types";
import { lesions, meta } from "./fixtures";
import { READER, draftReport, itemFromLesion, itemFromMark, referenceSource } from "./report";
import { headingOf, outliningSource, type ReportItem } from "./template";

const kidneyModel = outliningSource("ai", ["kidney", "tumour"]);
const tumour = itemFromLesion(lesions[0]); // left kidney, lower pole, 20 × 18 mm, image 11
const cyst = itemFromLesion(lesions[1]); // right kidney, 10 × 10 mm, image 31
const mark = (slice: number, lengthMm: number, side: "left" | "right" | null, kind: "tumour" | "cyst" | "unsure", organ: string) =>
  itemFromMark({ id: `m${slice}`, slice, from: [0, 0], to: [0, lengthMm], lengthMm, side, kind }, organ);
const lineOf = (text: string, heading: string) => text.split("\n").find((l) => l.startsWith(`${heading}: `));

describe("draftReport", () => {
  it("drafts the AI's read in the template, organ by organ", () => {
    const draft = draftReport(meta, [tumour], kidneyModel);
    expect(draft.problems).toEqual([]);
    expect(draft.text).toBe(
      [
        "CT ABDOMEN WITH IV CONTRAST (ARTERIAL PHASE)",
        "",
        "CLINICAL HISTORY: Not provided (teaching case).",
        "COMPARISON: None.",
        "TECHNIQUE: 40 axial images, 2 mm slices, arterial phase. Coronal and sagittal reconstructions.",
        "",
        "FINDINGS:",
        "Liver: Not assessed by the AI.",
        "Spleen, pancreas and adrenal glands: Not assessed by the AI.",
        "Right kidney: No mass outlined by the AI. Cysts not assessed.",
        "Left kidney: 20 × 18 mm mass at the lower pole (image 11 of 40). Mean attenuation 60 HU. Volume 3.4 cm³. Cysts not assessed.",
        "Lymph nodes: Not assessed by the AI.",
        "Bowel and appendix: Not assessed by the AI.",
        "Peritoneum: Not assessed by the AI.",
        "Lung bases: Not assessed by the AI.",
        "Bones: Not assessed by the AI.",
        "",
        "CONCLUSION: [For the radiologist to complete.]",
        "",
        "Draft from the AI's outlines. Check every measurement against the images.",
      ].join("\n"),
    );
  });

  it("leaves every line the reader did not measure for them to write", () => {
    const { text, problems } = draftReport(meta, [mark(4, 33.4, "right", "unsure", "kidney")], READER);
    expect(problems).toEqual([]);
    expect(lineOf(text, "Right kidney")).toBe("Right kidney: 33 mm indeterminate lesion (image 5 of 40).");
    expect(lineOf(text, "Left kidney")).toBe("Left kidney: [Your findings]");
    expect(lineOf(text, "Liver")).toBe("Liver: [Your findings]");
    expect(text).toContain("Draft from your measurements.");
    expect(text).not.toContain("HU");
  });

  it("says nothing was outlined only where the source looked, and for what it looked for", () => {
    const reference = outliningSource("reference", ["kidney", "tumour", "cyst"]);
    const { text } = draftReport(meta, [tumour], reference);
    expect(lineOf(text, "Right kidney")).toBe("Right kidney: No mass or cyst outlined in the reference.");
    expect(lineOf(text, "Liver")).toBe("Liver: Not outlined in the reference.");
    expect(text).not.toContain("not assessed");
  });

  it("puts the larger finding first, names the organ on shared lines, and keeps other organs apart", () => {
    const items: ReportItem[] = [
      mark(3, 12, "left", "cyst", "kidney"),
      mark(5, 25, "left", "tumour", "kidney"),
      mark(8, 14, null, "cyst", "pancreas"),
      mark(20, 15, "right", "tumour", "other"),
    ];
    const { text, problems } = draftReport(meta, items, READER);
    expect(problems).toEqual([]);
    expect(lineOf(text, "Left kidney")).toBe("Left kidney: 25 mm mass (image 6 of 40). 12 mm cyst (image 4 of 40).");
    expect(lineOf(text, "Spleen, pancreas and adrenal glands")).toBe(
      "Spleen, pancreas and adrenal glands: 14 mm cyst in the pancreas (image 9 of 40).",
    );
    expect(lineOf(text, "Other")).toBe("Other: 15 mm mass (image 21 of 40).");
  });

  it("titles the report from the case's phase, and leaves out what the case does not say", () => {
    const portal = { ...meta, description: "CT abdomen, portal venous (synthetic)" };
    expect(draftReport(portal, [], READER).text.split("\n")[0]).toBe("CT ABDOMEN WITH IV CONTRAST (PORTAL VENOUS PHASE)");
    const bare = { ...meta, description: "CT abdomen", geometry: { ...meta.geometry, sliceThicknessMm: null } };
    const { text, problems } = draftReport(bare, [], READER);
    expect(problems).toEqual([]);
    expect(text.split("\n")[0]).toBe("CT ABDOMEN");
    expect(text).toContain("TECHNIQUE: 40 axial images. Coronal and sagittal reconstructions.");
  });

  it("passes the checker whoever drafts it, and never interprets", () => {
    const sources = [READER, kidneyModel, outliningSource("reference", ["kidney", "tumour", "cyst", "liver"])];
    for (const source of sources) {
      for (const items of [[], [tumour], [tumour, cyst]]) {
        const { text, problems } = draftReport(meta, items, source);
        expect(problems).toEqual([]);
        expect(text).not.toMatch(/carcinoma|malignan|benign|normal|likely/i);
      }
    }
  });
});

describe("the phantom", () => {
  const phantom = phantomCase as unknown as CaseMeta;
  const truth = phantomTruth as unknown as Truth;

  it("drafts the reference's read of the tutorial case, every lesion on its organ's line", () => {
    const items = truth.lesions.map(itemFromLesion);
    const { text, problems } = draftReport(phantom, items, referenceSource(truth));
    expect(problems).toEqual([]);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(lineOf(text, headingOf(item))).toContain(`(image ${item.slice + 1} of ${phantom.geometry.slices})`);
    }
    // The phantom outlines the spleen, but not the pancreas or the adrenals: that line was not assessed.
    expect(lineOf(text, "Spleen, pancreas and adrenal glands")).toBe(
      "Spleen, pancreas and adrenal glands: Not outlined in the reference.",
    );
  });
});
