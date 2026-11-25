import { describe, expect, it } from "vitest";
import {
  directionLetter,
  distanceToLine,
  fraction,
  meetingPoint,
  nearestSlice,
  offsetTo,
  planeName,
  type Plane,
  type Vec3,
} from "./mpr";

// The three standard planes as Cornerstone sets them up (mprCameraValues).
const axial = (z: number): Plane => ({ normal: [0, 0, -1], point: [0, 0, z] });
const coronal = (y: number): Plane => ({ normal: [0, -1, 0], point: [0, y, 0] });
const sagittal = (x: number): Plane => ({ normal: [1, 0, 0], point: [x, 0, 0] });

describe("meetingPoint", () => {
  it("is where the axial, coronal and sagittal planes cross", () => {
    expect(meetingPoint(axial(-120), coronal(35), sagittal(-40))).toEqual([-40, 35, -120]);
  });

  it("does not depend on which point of a plane is given", () => {
    const a: Plane = { normal: [0, 0, -1], point: [99, -7, -120] };
    const c: Plane = { normal: [0, -1, 0], point: [12, 35, 400] };
    const s: Plane = { normal: [1, 0, 0], point: [-40, 3, 3] };
    expect(meetingPoint(a, c, s)).toEqual([-40, 35, -120]);
  });

  it("handles a tilted plane", () => {
    const tilted: Plane = { normal: [0, Math.SQRT1_2, Math.SQRT1_2], point: [0, 0, 10] };
    const p = meetingPoint(tilted, sagittal(5), coronal(4))!;
    expect(p[0]).toBeCloseTo(5);
    expect(p[1]).toBeCloseTo(4);
    expect(p[2]).toBeCloseTo(6);
  });

  it("is null when two planes are parallel", () => {
    expect(meetingPoint(axial(0), axial(10), sagittal(0))).toBeNull();
  });
});

describe("offsetTo", () => {
  it("measures along the normal, whichever way it points", () => {
    expect(offsetTo(coronal(10), [0, 25, 0])).toBe(-15);
    expect(offsetTo(sagittal(10), [25, 99, 99])).toBe(15);
  });
});

describe("distanceToLine", () => {
  it("is the perpendicular distance, beyond the ends too", () => {
    expect(distanceToLine([5, 3], [0, 0], [10, 0])).toBe(3);
    expect(distanceToLine([50, -4], [0, 0], [10, 0])).toBe(4);
    expect(distanceToLine([3, 4], [0, 0], [0, 0])).toBe(5);
  });
});

describe("directionLetter", () => {
  it("uses DICOM patient directions: +x left, +y posterior, +z superior", () => {
    const cases: [Vec3, string][] = [
      [[1, 0, 0], "L"],
      [[-1, 0, 0], "R"],
      [[0, 1, 0], "P"],
      [[0, -1, 0], "A"],
      [[0, 0, 1], "S"],
      [[0, 0, -1], "I"],
      [[0.2, -0.9, 0.1], "A"],
    ];
    for (const [v, letter] of cases) expect(directionLetter(v)).toBe(letter);
  });
});

describe("planeName", () => {
  it("names the plane a view looks at", () => {
    expect(planeName([0, 0, -1])).toBe("axial");
    expect(planeName([0, -1, 0])).toBe("coronal");
    expect(planeName([1, 0, 0])).toBe("sagittal");
    expect(planeName([0.1, 0.05, 0.99])).toBe("axial");
  });
});

describe("nearestSlice", () => {
  // Head first: slice 0 is the most superior, so z falls as the index rises.
  const first: Vec3 = [-200, -200, 100];
  const last: Vec3 = [-200, -200, -160];
  it("rounds to the nearest slice and stays in range", () => {
    expect(nearestSlice([0, 0, 100], first, last, 261)).toBe(0);
    expect(nearestSlice([0, 0, -160], first, last, 261)).toBe(260);
    expect(nearestSlice([0, 0, 0.4], first, last, 261)).toBe(100);
    expect(nearestSlice([0, 0, 500], first, last, 261)).toBe(0);
    expect(nearestSlice([0, 0, -500], first, last, 261)).toBe(260);
  });

  it("copes with a single slice", () => {
    expect(nearestSlice([0, 0, 0], first, first, 1)).toBe(0);
  });
});

describe("fraction", () => {
  it("runs from the smaller end to the larger, clamped", () => {
    expect(fraction(5, 0, 10)).toBe(0.5);
    expect(fraction(5, 10, 0)).toBe(0.5);
    expect(fraction(-5, 0, 10)).toBe(0);
    expect(fraction(15, 0, 10)).toBe(1);
    expect(fraction(3, 3, 3)).toBe(0.5);
  });
});
