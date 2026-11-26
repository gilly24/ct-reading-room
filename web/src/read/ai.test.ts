import { describe, expect, it } from "vitest";
import type { Lesion } from "../case/types";
import { marksFromLesions } from "./ai";
import { lesions } from "./fixtures";
import { scoreRead } from "./scoring";

const options = { pixelSpacingMm: [1, 1] as [number, number] };

describe("scoring the AI like a reader", () => {
  it("gives a model that outlines exactly the reference full marks", () => {
    const score = scoreRead(marksFromLesions(lesions), lesions, options);
    expect(score.found).toBe(score.total);
    expect(score.falsePositives).toEqual([]);
    expect(score.meanAbsErrorMm).toBe(0);
  });

  it("counts an outline on nothing as a false positive, and a missed tumour as missed", () => {
    const elsewhere: Lesion = {
      ...lesions[0],
      id: "T2",
      longAxis: { slice: 50, from: [10, 10], to: [10, 20] },
      boxes: [[50, 5, 5, 15, 25]],
    };
    const score = scoreRead(marksFromLesions([elsewhere]), lesions, options);
    expect(score.found).toBe(0);
    expect(score.falsePositives).toEqual(["ai-T2"]);
  });

  it("measures the size error from the AI's own long axis", () => {
    const bigger = { ...lesions[0], longAxisMm: 23 };
    const score = scoreRead(marksFromLesions([bigger]), lesions, options);
    expect(score.tumours[0].errorMm).toBe(3);
  });
});
