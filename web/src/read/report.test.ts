import { describe, expect, it } from "vitest";
import { lesions, meta } from "./fixtures";
import { draftReport, itemFromLesion, itemFromMark } from "./report";

describe("draftReport", () => {
  it("lists each finding under its organ, with size, place and image", () => {
    const text = draftReport(meta, lesions.map(itemFromLesion), "the reference outlines");
    expect(text).toContain("Technique: Arterial phase. 40 axial images.");
    expect(text).toContain("Kidneys:");
    expect(text).toContain("- Left kidney, lower pole: 20 × 18 mm mass (image 11 of 40). Mean attenuation 60 HU. Volume 3.4 cm³.");
    expect(text).toContain("- Right kidney: 10 × 10 mm cyst (image 31 of 40).");
  });

  it("puts the larger finding first and leaves the impression to a person", () => {
    const text = draftReport(meta, lesions.map(itemFromLesion), "x");
    expect(text.indexOf("20 × 18")).toBeLessThan(text.indexOf("10 × 10"));
    expect(text).toContain("[For the radiologist to complete.]");
    expect(text).not.toMatch(/carcinoma|malignan|benign/i);
  });

  it("says so when nothing was measured", () => {
    expect(draftReport(meta, [], "x")).toContain("No focal lesion measured.");
  });

  it("drafts from a reader's mark without inventing what it does not know", () => {
    const item = itemFromMark(
      { id: "a", slice: 4, from: [0, 0], to: [0, 33], lengthMm: 33.4, side: "right", kind: "unsure" },
      "kidney",
    );
    const text = draftReport(meta, [item], "your measurements");
    expect(text).toContain("- Right kidney: 33 mm indeterminate lesion (image 5 of 40).");
    expect(text).not.toContain("HU");
  });
});
