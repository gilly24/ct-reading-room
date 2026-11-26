// The report template (docs/report-format.md), in one place. The drafter
// (report.ts) writes it and the checker (checker.ts) holds drafts to it, so
// the two can never disagree about a heading, a number's format or what a
// source may say.

import type { CaseMeta } from "../case/types";
import type { MarkKind } from "./marks";

export type Side = "left" | "right";
export type Pole = "upper" | "interpolar" | "lower";

/** One finding to put in the report, wherever it came from: the reader, the reference or the AI. */
export type ReportItem = {
  organ: string | null;
  side: Side | null;
  pole: Pole | null;
  kind: MarkKind;
  longMm: number;
  shortMm: number | null;
  slice: number;
  meanHu: number | null;
  volumeCm3: number | null;
};

// ---- Sections ----------------------------------------------------------------

export const SECTIONS = {
  history: "CLINICAL HISTORY",
  comparison: "COMPARISON",
  technique: "TECHNIQUE",
  findings: "FINDINGS",
  conclusion: "CONCLUSION",
} as const;

/** What public datasets cannot tell us, and the conclusion, which is always the person's. */
export const FIXED = {
  history: "Not provided (teaching case).",
  comparison: "None.",
  conclusion: "[For the radiologist to complete.]",
} as const;

const PHASES = ["portal venous", "arterial", "nephrographic", "excretory", "delayed", "venous", "non-contrast", "unenhanced"];

/** The contrast phase named in a case's description, if any. "portal venous" is looked for before "venous". */
export function phaseOf(description: string): string | null {
  const text = description.toLowerCase();
  return PHASES.find((p) => text.includes(p)) ?? null;
}

export function titleOf(meta: CaseMeta): string {
  const phase = phaseOf(meta.description);
  if (!phase) return "CT ABDOMEN";
  if (phase === "non-contrast" || phase === "unenhanced") return "CT ABDOMEN WITHOUT IV CONTRAST";
  return `CT ABDOMEN WITH IV CONTRAST (${phase.toUpperCase()} PHASE)`;
}

export function techniqueOf(meta: CaseMeta): string {
  const { slices, sliceThicknessMm } = meta.geometry;
  const phase = phaseOf(meta.description);
  const parts = [
    `${slices} axial images`,
    sliceThicknessMm ? `${format.thickness(sliceThicknessMm)} mm slices` : null,
    phase ? `${phase} phase` : null,
  ].filter(Boolean);
  return `${parts.join(", ")}. Coronal and sagittal reconstructions.`;
}

// ---- Numbers -----------------------------------------------------------------

/** How each kind of number is written. The checker formats the findings the same way to know what is allowed. */
export const format = {
  mm: (v: number) => v.toFixed(0),
  hu: (v: number) => String(Math.round(v)),
  volume: (v: number) => v.toFixed(1),
  image: (slice: number) => String(slice + 1),
  thickness: (v: number) => String(Number(v.toFixed(3))),
};

// ---- Organ lines -------------------------------------------------------------

export type GroupId =
  | "liver"
  | "upperAbdomen"
  | "rightKidney"
  | "leftKidney"
  | "lymphNodes"
  | "bowel"
  | "peritoneum"
  | "lungBases"
  | "bones";

export type OrganGroup = { id: GroupId; heading: string; organs: readonly string[]; side?: Side };

/** The findings, one line per group, in the template's order. */
export const ORGAN_GROUPS: readonly OrganGroup[] = [
  { id: "liver", heading: "Liver", organs: ["liver"] },
  { id: "upperAbdomen", heading: "Spleen, pancreas and adrenal glands", organs: ["spleen", "pancreas", "adrenal"] },
  { id: "rightKidney", heading: "Right kidney", organs: ["kidney"], side: "right" },
  { id: "leftKidney", heading: "Left kidney", organs: ["kidney"], side: "left" },
  { id: "lymphNodes", heading: "Lymph nodes", organs: [] },
  { id: "bowel", heading: "Bowel and appendix", organs: [] },
  { id: "peritoneum", heading: "Peritoneum", organs: [] },
  { id: "lungBases", heading: "Lung bases", organs: [] },
  { id: "bones", heading: "Bones", organs: [] },
];

/** A finding no line names (an organ outside the template, or a kidney without a side) goes on this extra line. */
export const OTHER_HEADING = "Other";

/** Every organ word a findings line could use. A line may only name the organs of its own findings. */
export const ORGAN_WORDS = ["kidney", "liver", "pancreas", "spleen", "adrenal"];

export function groupOf(item: Pick<ReportItem, "organ" | "side">): OrganGroup | null {
  const { organ, side } = item;
  if (!organ) return null;
  return ORGAN_GROUPS.find((g) => g.organs.includes(organ) && (!g.side || g.side === side)) ?? null;
}

/** The heading a finding is reported under. */
export const headingOf = (item: Pick<ReportItem, "organ" | "side">) => groupOf(item)?.heading ?? OTHER_HEADING;

/** Findings by the line they go on. */
export function itemsByHeading(items: ReportItem[]): Map<string, ReportItem[]> {
  const lines = new Map<string, ReportItem[]>();
  for (const item of items) lines.set(headingOf(item), [...(lines.get(headingOf(item)) ?? []), item]);
  return lines;
}

// ---- Findings words ----------------------------------------------------------

export const KIND_WORDS: Record<MarkKind, string> = { tumour: "mass", cyst: "cyst", unsure: "indeterminate lesion" };
const KIND_PLURALS: Record<LesionKind, string> = { tumour: "Masses", cyst: "Cysts" };

export const POLE_WORDS: Record<Pole, string> = {
  upper: "at the upper pole",
  interpolar: "in the interpolar region",
  lower: "at the lower pole",
};

// ---- Who drafted it ----------------------------------------------------------

export type LesionKind = "tumour" | "cyst";
const LESION_KINDS: readonly LesionKind[] = ["tumour", "cyst"];

/**
 * Who a draft is from, and what they checked. Only the organ lines a source
 * assessed may say that nothing was found there; every other line says it was
 * not assessed. Finding nothing you did not look for is not finding nothing.
 */
export type Source = {
  kind: "reader" | "reference" | "ai";
  /** The lesions the source outlines. */
  lesionKinds: LesionKind[];
  /** The organ lines it looked at for those lesions. */
  assessed: GroupId[];
};

/** The reader writes their own report: the drafter claims nothing for them beyond what they measured. */
export const READER: Source = { kind: "reader", lesionKinds: [], assessed: [] };

/**
 * A source that outlines classes, such as the reference or a model. It looked
 * for the lesions it outlines in every organ line whose organs it all outlines:
 * a kidney model that outlines kidney and tumour assessed the kidneys for masses,
 * and nothing else.
 */
export function outliningSource(kind: "reference" | "ai", classes: Iterable<string>): Source {
  const outlined = new Set(classes);
  const lesionKinds = LESION_KINDS.filter((k) => outlined.has(k));
  const assessed = lesionKinds.length
    ? ORGAN_GROUPS.filter((g) => g.organs.length > 0 && g.organs.every((o) => outlined.has(o))).map((g) => g.id)
    : [];
  return { kind, lesionKinds, assessed };
}

const WORDING: Record<Source["kind"], { from: string; notAssessed: string; outlinedBy: string }> = {
  reader: { from: "your measurements", notAssessed: "[Your findings]", outlinedBy: "by you" },
  reference: { from: "the reference outlines", notAssessed: "Not outlined in the reference.", outlinedBy: "in the reference" },
  ai: { from: "the AI's outlines", notAssessed: "Not assessed by the AI.", outlinedBy: "by the AI" },
};

/** The line for an organ the source did not assess. */
export const notAssessed = (source: Source) => WORDING[source.kind].notAssessed;

/** The line for an assessed organ with nothing outlined: "No mass outlined by the AI." */
export const nothingOutlined = (source: Source) =>
  `No ${source.lesionKinds.map((k) => KIND_WORDS[k]).join(" or ")} outlined ${WORDING[source.kind].outlinedBy}.`;

/** What an assessed line adds about the lesions the source does not outline: "Cysts not assessed." */
export const notLookedFor = (source: Source) =>
  LESION_KINDS.filter((k) => !source.lesionKinds.includes(k)).map((k) => `${KIND_PLURALS[k]} not assessed.`);

export const footerOf = (source: Source) => `Draft from ${WORDING[source.kind].from}. Check every measurement against the images.`;
