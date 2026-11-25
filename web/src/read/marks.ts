import type { PixelPoint } from "../case/types";

export type MarkKind = "tumour" | "cyst" | "unsure";

/** One measurement the reader drew: a long-axis line on one slice. */
export type Mark = {
  id: string;
  /** Index into the case's images; 0 is the most superior slice. */
  slice: number;
  from: PixelPoint;
  to: PixelPoint;
  lengthMm: number;
  side: "left" | "right" | null;
  kind: MarkKind;
};

export const midpoint = (m: Pick<Mark, "from" | "to">): PixelPoint => [
  (m.from[0] + m.to[0]) / 2,
  (m.from[1] + m.to[1]) / 2,
];
