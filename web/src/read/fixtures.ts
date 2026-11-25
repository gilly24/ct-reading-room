import type { CaseMeta, Lesion } from "../case/types";

/** A 20 mm tumour on slices 9-11 and a 10 mm cyst on slice 30, 1 mm pixels. */
export const lesions: Lesion[] = [
  {
    id: "T1",
    kind: "tumour",
    organ: "kidney",
    side: "left",
    pole: "lower",
    sliceRange: [9, 11],
    keySlice: 10,
    longAxisMm: 20,
    shortAxisMm: 18,
    volumeCm3: 3.4,
    meanHu: 60,
    longAxis: { slice: 10, from: [100, 90], to: [100, 110] },
    centroidWorld: [50, 40, -100],
    boxes: [
      [9, 92, 92, 108, 108],
      [10, 91, 90, 109, 110],
      [11, 92, 92, 108, 108],
    ],
  },
  {
    id: "C1",
    kind: "cyst",
    organ: "kidney",
    side: "right",
    pole: null,
    sliceRange: [30, 30],
    keySlice: 30,
    longAxisMm: 10,
    shortAxisMm: 10,
    volumeCm3: 0.5,
    meanHu: 5,
    longAxis: { slice: 30, from: [50, 20], to: [50, 30] },
    centroidWorld: [-50, 40, -120],
    boxes: [[30, 45, 20, 55, 30]],
  },
];

export const meta: CaseMeta = {
  schema: 1,
  id: "test",
  title: "Test",
  modality: "CT",
  description: "CT abdomen, arterial phase",
  patient: {},
  geometry: {
    rows: 200,
    columns: 200,
    slices: 40,
    pixelSpacingMm: [1, 1],
    sliceSpacingMm: 2,
    sliceThicknessMm: 2,
    order: "head-first",
  },
  window: { center: 40, width: 400 },
  images: [],
  source: { dataset: "test", collection: null, citation: "", url: null, licence: "MIT" },
  truth: "truth.json",
  ai: null,
};
