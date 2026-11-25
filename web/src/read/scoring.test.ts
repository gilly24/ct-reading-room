import { describe, expect, it } from "vitest";
import { lesions } from "./fixtures";
import type { Mark } from "./marks";
import { scoreRead } from "./scoring";

const mark = (id: string, slice: number, row: number, c0: number, c1: number, extra: Partial<Mark> = {}): Mark => ({
  id,
  slice,
  from: [row, c0],
  to: [row, c1],
  lengthMm: Math.abs(c1 - c0),
  side: null,
  kind: "tumour",
  ...extra,
});

const score = (marks: Mark[]) => scoreRead(marks, lesions, { pixelSpacingMm: [1, 1] });

describe("scoreRead", () => {
  it("finds a tumour measured across its middle", () => {
    const s = score([mark("a", 10, 100, 91, 109)]);
    expect(s.found).toBe(1);
    expect(s.total).toBe(1);
    expect(s.tumours[0]).toMatchObject({ markId: "a", markMm: 18, errorMm: -2 });
    expect(s.meanAbsErrorMm).toBe(2);
    expect(s.falsePositives).toEqual([]);
  });

  it("accepts the slice next to the lesion, but not two away", () => {
    expect(score([mark("a", 12, 100, 92, 108)]).found).toBe(1);
    expect(score([mark("a", 13, 100, 92, 108)]).found).toBe(0);
  });

  it("calls a mark far from everything a false positive", () => {
    const s = score([mark("a", 10, 10, 10, 20)]);
    expect(s.found).toBe(0);
    expect(s.falsePositives).toEqual(["a"]);
    expect(s.tumours[0].markId).toBeNull();
  });

  it("gives the lesion to the closest mark and counts the other as a duplicate", () => {
    const s = score([mark("edge", 10, 108, 100, 112), mark("centre", 10, 100, 90, 110)]);
    expect(s.tumours[0].markId).toBe("centre");
    expect(s.duplicates).toEqual(["edge"]);
    expect(s.falsePositives).toEqual([]);
  });

  it("does not count a tumour the reader called a cyst", () => {
    const s = score([mark("a", 10, 100, 90, 110, { kind: "cyst" })]);
    expect(s.found).toBe(0);
    expect(s.tumours[0].markKind).toBe("cyst");
  });

  it("reports a measured cyst separately, not as a false positive", () => {
    const s = score([mark("a", 30, 50, 20, 30, { kind: "tumour" })]);
    expect(s.cysts).toHaveLength(1);
    expect(s.cysts[0]).toMatchObject({ markId: "a", markKind: "tumour" });
    expect(s.falsePositives).toEqual([]);
  });

  it("scales the margin by pixel spacing", () => {
    // 4 pixels outside the box: inside 5 mm at 1 mm pixels, outside it at 2 mm.
    const m = [mark("a", 10, 113, 100, 100)];
    expect(scoreRead(m, lesions, { pixelSpacingMm: [1, 1] }).found).toBe(1);
    expect(scoreRead(m, lesions, { pixelSpacingMm: [2, 2] }).found).toBe(0);
  });
});
