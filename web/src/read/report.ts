import type { CaseMeta, Lesion } from "../case/types";
import type { Mark, MarkKind } from "./marks";

/** One finding to put in the report, wherever it came from (the reader, the
 *  reference or, later, the AI). */
export type ReportItem = {
  organ: string | null;
  side: "left" | "right" | null;
  pole: "upper" | "interpolar" | "lower" | null;
  kind: MarkKind;
  longMm: number;
  shortMm: number | null;
  slice: number;
  meanHu: number | null;
  volumeCm3: number | null;
};

const ORGAN_ORDER = ["kidney", "liver", "pancreas", "spleen"];
const ORGAN_HEADINGS: Record<string, string> = {
  kidney: "Kidneys",
  liver: "Liver",
  pancreas: "Pancreas",
  spleen: "Spleen",
};
const KIND_WORDS: Record<MarkKind, string> = {
  tumour: "mass",
  cyst: "cyst",
  unsure: "indeterminate lesion",
};

/**
 * A draft report from measured findings. It only states what was measured;
 * the impression is left for the radiologist, because deciding what a
 * finding means is their job, not the drafter's.
 */
export function draftReport(meta: CaseMeta, items: ReportItem[], drafter: string): string {
  const total = meta.geometry.slices;
  const lines: string[] = [];
  lines.push("CT ABDOMEN");
  lines.push("");
  lines.push(`Technique: ${capitalise(meta.description.replace(/^CT abdomen,?\s*/i, ""))}. ${total} axial images.`);
  lines.push("");
  lines.push("Findings");

  if (items.length === 0) {
    lines.push("No focal lesion measured.");
  } else {
    const groups = new Map<string, ReportItem[]>();
    for (const item of items) {
      const key = item.organ && ORGAN_HEADINGS[item.organ] ? item.organ : "other";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const rank = (key: string) => {
      const i = ORGAN_ORDER.indexOf(key);
      return i === -1 ? ORGAN_ORDER.length : i;
    };
    const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b));
    for (const key of keys) {
      lines.push(`${ORGAN_HEADINGS[key] ?? "Other"}:`);
      const sorted = [...groups.get(key)!].sort((a, b) => b.longMm - a.longMm);
      for (const item of sorted) lines.push(`- ${describe(item, total)}`);
    }
  }

  lines.push("");
  lines.push("Impression");
  lines.push("[For the radiologist to complete.]");
  lines.push("");
  lines.push(`Draft from ${drafter}. Check every measurement against the images.`);
  return lines.join("\n");
}

function describe(item: ReportItem, total: number): string {
  const where = [
    item.organ === "kidney" && item.side ? `${capitalise(item.side)} kidney` : null,
    item.organ !== "kidney" && item.organ ? capitalise(item.organ) : null,
    !item.organ && item.side ? `${capitalise(item.side)} side` : null,
    item.pole ? (item.pole === "interpolar" ? "interpolar region" : `${item.pole} pole`) : null,
  ]
    .filter(Boolean)
    .join(", ");
  const size = item.shortMm ? `${mm(item.longMm)} × ${mm(item.shortMm)} mm` : `${mm(item.longMm)} mm`;
  const parts = [`${where ? `${where}: ` : ""}${size} ${KIND_WORDS[item.kind]} (image ${item.slice + 1} of ${total}).`];
  if (item.meanHu !== null) parts.push(`Mean attenuation ${Math.round(item.meanHu)} HU.`);
  if (item.volumeCm3 !== null) parts.push(`Volume ${item.volumeCm3.toFixed(1)} cm³.`);
  return parts.join(" ");
}

export function itemFromMark(mark: Mark, organ: string | null): ReportItem {
  return {
    organ,
    side: mark.side,
    pole: null,
    kind: mark.kind,
    longMm: mark.lengthMm,
    shortMm: null,
    slice: mark.slice,
    meanHu: null,
    volumeCm3: null,
  };
}

export function itemFromLesion(lesion: Lesion): ReportItem {
  return {
    organ: lesion.organ,
    side: lesion.side,
    pole: lesion.pole,
    kind: lesion.kind,
    longMm: lesion.longAxisMm,
    shortMm: lesion.shortAxisMm,
    slice: lesion.keySlice,
    meanHu: lesion.meanHu,
    volumeCm3: lesion.volumeCm3,
  };
}

const mm = (v: number) => v.toFixed(0);
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
