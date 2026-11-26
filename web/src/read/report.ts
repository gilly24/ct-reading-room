import type { AiFindings, CaseMeta, Lesion, Truth } from "../case/types";
import { checkDraft, type Problem } from "./checker";
import type { Mark } from "./marks";
import {
  FIXED,
  KIND_WORDS,
  ORGAN_GROUPS,
  ORGAN_WORDS,
  OTHER_HEADING,
  POLE_WORDS,
  SECTIONS,
  footerOf,
  format,
  groupOf,
  itemsByHeading,
  notAssessed,
  notLookedFor,
  nothingOutlined,
  outliningSource,
  techniqueOf,
  titleOf,
  type OrganGroup,
  type ReportItem,
  type Source,
} from "./template";

export { READER } from "./template";
export type { ReportItem, Source } from "./template";
export type { Problem } from "./checker";

/** A draft and what the checker found wrong with it. A draft with problems is never shown. */
export type Draft = { text: string; problems: Problem[] };

/** What the reference outlined, from the classes in its label volume. */
export const referenceSource = (truth: Truth) => outliningSource("reference", Object.values(truth.labels.classes));

/** What the AI outlines: every class the model can output, found in this case or not. */
export const aiSource = (ai: AiFindings) => outliningSource("ai", ai.model.outlines);

/**
 * A report in the template's layout (docs/report-format.md), drafted from
 * measured findings and then checked. It states what was measured, says which
 * organs the source did not assess, and leaves the conclusion to a person,
 * because deciding what a finding means is the radiologist's job.
 */
export function draftReport(meta: CaseMeta, items: ReportItem[], source: Source): Draft {
  const text = writeReport(meta, items, source);
  return { text, problems: checkDraft(text, meta, items, source) };
}

function writeReport(meta: CaseMeta, items: ReportItem[], source: Source): string {
  const total = meta.geometry.slices;
  const byHeading = itemsByHeading(items);
  const findings = ORGAN_GROUPS.map((g) => `${g.heading}: ${organLine(g, byHeading.get(g.heading) ?? [], source, total)}`);
  const other = byHeading.get(OTHER_HEADING);
  if (other) findings.push(`${OTHER_HEADING}: ${measured(other, total).join(" ")}`);

  return [
    titleOf(meta),
    "",
    `${SECTIONS.history}: ${FIXED.history}`,
    `${SECTIONS.comparison}: ${FIXED.comparison}`,
    `${SECTIONS.technique}: ${techniqueOf(meta)}`,
    "",
    `${SECTIONS.findings}:`,
    ...findings,
    "",
    `${SECTIONS.conclusion}: ${FIXED.conclusion}`,
    "",
    footerOf(source),
  ].join("\n");
}

/** One organ line: what was measured there, or what can honestly be said about it. */
function organLine(group: OrganGroup, found: ReportItem[], source: Source, total: number): string {
  if (!source.assessed.includes(group.id)) return found.length ? measured(found, total).join(" ") : notAssessed(source);
  const said = found.length ? measured(found, total) : [nothingOutlined(source)];
  return [...said, ...notLookedFor(source)].join(" ");
}

/** The findings as sentences, largest first. */
const measured = (items: ReportItem[], total: number) =>
  [...items].sort((a, b) => b.longMm - a.longMm).map((item) => describe(item, total));

function describe(item: ReportItem, total: number): string {
  const size = item.shortMm ? `${format.mm(item.longMm)} × ${format.mm(item.shortMm)} mm` : `${format.mm(item.longMm)} mm`;
  const where = [placeOf(item), item.organ === "kidney" && item.pole ? POLE_WORDS[item.pole] : null].filter(Boolean);
  const parts = [`${[size, KIND_WORDS[item.kind], ...where].join(" ")} (image ${format.image(item.slice)} of ${total}).`];
  if (item.meanHu !== null) parts.push(`Mean attenuation ${format.hu(item.meanHu)} HU.`);
  if (item.volumeCm3 !== null) parts.push(`Volume ${format.volume(item.volumeCm3)} cm³.`);
  return parts.join(" ");
}

/** The organ, when the line's heading does not already say it: "in the pancreas" on the spleen, pancreas and adrenal line. */
function placeOf(item: ReportItem): string | null {
  const group = groupOf(item);
  if (!item.organ || !ORGAN_WORDS.includes(item.organ) || (group && group.organs.length === 1)) return null;
  return `in the ${item.organ}`;
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
