import type { Lesion } from "../case/types";
import { midpoint, type Mark, type MarkKind } from "./marks";

export type LesionResult = {
  lesion: Lesion;
  markId: string | null;
  markKind: MarkKind | null;
  markMm: number | null;
  /** markMm minus the reference long axis. */
  errorMm: number | null;
};

export type Score = {
  /** Every tumour in the reference, found or not. */
  tumours: LesionResult[];
  /** Cysts the reader measured. */
  cysts: LesionResult[];
  /** Tumours found: measured and not called a cyst. */
  found: number;
  total: number;
  /** Marks that are on no lesion at all. */
  falsePositives: string[];
  /** Second and later marks on a lesion already matched. */
  duplicates: string[];
  meanAbsErrorMm: number | null;
};

export type ScoreOptions = {
  pixelSpacingMm: [number, number];
  /** How far outside a lesion's outline a mark's centre may be and still count. */
  marginMm?: number;
  /** How many slices above or below the lesion a mark may be. */
  sliceTolerance?: number;
};

/**
 * Match the reader's measurements to the reference lesions.
 *
 * A mark is on a lesion when its centre lies within the lesion's outline box on
 * that slice (or a slice next to it), give or take marginMm. Each lesion takes at
 * most one mark: the closest.
 */
export function scoreRead(marks: Mark[], lesions: Lesion[], options: ScoreOptions): Score {
  const margin = options.marginMm ?? 5;
  const tolerance = options.sliceTolerance ?? 1;
  const [rowMm, colMm] = options.pixelSpacingMm;

  type Pair = { mark: Mark; lesion: Lesion; distanceMm: number };
  const pairs: Pair[] = [];
  for (const mark of marks) {
    const [r, c] = midpoint(mark);
    for (const lesion of lesions) {
      let best = Infinity;
      for (const [slice, r0, c0, r1, c1] of lesion.boxes) {
        const sliceGap = Math.abs(slice - mark.slice);
        if (sliceGap > tolerance) continue;
        const dr = Math.max(r0 - r, 0, r - r1) * rowMm;
        const dc = Math.max(c0 - c, 0, c - c1) * colMm;
        const outside = Math.hypot(dr, dc);
        if (outside > margin) continue;
        const centre = Math.hypot((r - (r0 + r1) / 2) * rowMm, (c - (c0 + c1) / 2) * colMm);
        best = Math.min(best, centre + sliceGap * 10);
      }
      if (best < Infinity) pairs.push({ mark, lesion, distanceMm: best });
    }
  }
  pairs.sort((a, b) => a.distanceMm - b.distanceMm);

  const markFor = new Map<string, Mark>();
  const usedMarks = new Set<string>();
  const nearSomething = new Set<string>();
  for (const { mark, lesion } of pairs) {
    nearSomething.add(mark.id);
    if (usedMarks.has(mark.id) || markFor.has(lesion.id)) continue;
    markFor.set(lesion.id, mark);
    usedMarks.add(mark.id);
  }

  const result = (lesion: Lesion): LesionResult => {
    const mark = markFor.get(lesion.id) ?? null;
    return {
      lesion,
      markId: mark?.id ?? null,
      markKind: mark?.kind ?? null,
      markMm: mark ? round1(mark.lengthMm) : null,
      errorMm: mark ? round1(mark.lengthMm - lesion.longAxisMm) : null,
    };
  };

  const tumours = lesions.filter((l) => l.kind === "tumour").map(result);
  const cysts = lesions.filter((l) => l.kind === "cyst").map(result).filter((r) => r.markId);
  const foundResults = tumours.filter((t) => t.markId && t.markKind !== "cyst");
  const errors = foundResults.map((t) => Math.abs(t.errorMm ?? 0));

  return {
    tumours,
    cysts,
    found: foundResults.length,
    total: tumours.length,
    falsePositives: marks.filter((m) => !nearSomething.has(m.id)).map((m) => m.id),
    duplicates: marks.filter((m) => nearSomething.has(m.id) && !usedMarks.has(m.id)).map((m) => m.id),
    meanAbsErrorMm: errors.length ? round1(errors.reduce((a, b) => a + b, 0) / errors.length) : null,
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
