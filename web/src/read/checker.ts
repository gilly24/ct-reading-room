// The checker: a draft report is refused, and not shown, if it says anything
// its findings do not support (docs/report-format.md, "Rules the checker
// enforces"). It reads the text, not the drafter's intentions, so it holds any
// writer to the same rules: today's template drafter, and a language model later.

import type { CaseMeta } from "../case/types";
import {
  FIXED,
  ORGAN_GROUPS,
  OTHER_HEADING,
  POLE_WORDS,
  SECTIONS,
  format,
  itemsByHeading,
  titleOf,
  type ReportItem,
  type Side,
  type Source,
} from "./template";

/** Something a draft may not say. `line` counts from 1; 0 is the draft as a whole. */
export type Problem = { line: number; text: string; reason: string };

/** Words only a radiologist may write, whatever the findings. */
const REFUSED_WORDS: { reason: string; pattern: RegExp }[] = [
  {
    reason: "names a diagnosis",
    pattern:
      /\b(carcinoma|cancer|malignan\w*|benign|metasta\w*|lymphoma|granuloma\w*|ha?emorrhag\w*|angiomyolipoma|oncocytoma|abscess\w*|neoplas\w*|bosniak)\b/i,
  },
  {
    reason: "says how likely something is",
    pattern:
      /\b(likely|unlikely|probabl[ey]|possibl[ey]|suggest\w*|consistent with|represent\w*|in keeping with|compatible with|suspicious|concerning for|favou?r\w*|presum\w*|cannot be excluded|differential)\b/i,
  },
  {
    reason: "gives advice",
    pattern:
      /\b(recommend\w*|advis\w*|further (?:evaluation|assessment|imaging)|follow[- ]?up|ultrasound|mri|biops\w*|correlat\w*|refer(?:ral|red|ring)?|should)\b/i,
  },
  { reason: "calls something normal or abnormal", pattern: /\b(normal|abnormal\w*|unremarkable|no significant|within normal limits)\b/i },
];

/** A statement that something is not there, which only an organ the source assessed may carry. */
const NEGATIVE = /\b(no|none|not seen|without|absent|negative)\b/i;

const SIDE_WORDS: Record<Side, RegExp> = { left: /\bleft\b/i, right: /\bright\b/i };
const POLE_PATTERNS = Object.fromEntries(
  Object.keys(POLE_WORDS).map((pole) => [pole, pole === "interpolar" ? /\binterpolar\b/i : new RegExp(`\\b${pole} pole\\b`, "i")]),
) as Record<keyof typeof POLE_WORDS, RegExp>;
const ORGAN_PATTERNS: Record<string, RegExp> = {
  kidney: /\b(kidneys?|renal)\b/i,
  liver: /\b(liver|hepatic)\b/i,
  pancreas: /\b(pancreas|pancreatic)\b/i,
  spleen: /\b(spleen|splenic)\b/i,
  adrenal: /\badrenals?\b/i,
};

const numbersIn = (text: string) => text.match(/-?\d+(?:\.\d+)?/g) ?? [];

/** Every number a finding allows on its line, written as the drafter writes it. */
function numbersOf(items: ReportItem[], total: number): Set<string> {
  const allowed = new Set([String(total)]);
  for (const i of items) {
    allowed.add(format.mm(i.longMm)).add(format.image(i.slice));
    if (i.shortMm !== null) allowed.add(format.mm(i.shortMm));
    if (i.meanHu !== null) allowed.add(format.hu(i.meanHu));
    if (i.volumeCm3 !== null) allowed.add(format.volume(i.volumeCm3));
  }
  return allowed;
}

export function checkDraft(text: string, meta: CaseMeta, items: ReportItem[], source: Source): Problem[] {
  const lines = text.split("\n");
  const total = meta.geometry.slices;
  const problems: Problem[] = [];
  const flag = (index: number, reason: string) => problems.push({ line: index + 1, text: lines[index] ?? "", reason });
  const sectionAt = (name: string) => lines.findIndex((l) => l.startsWith(`${name}:`));

  // The words no draft may use, anywhere.
  lines.forEach((line, i) => {
    for (const rule of REFUSED_WORDS) {
      const found = line.match(rule.pattern);
      if (found) flag(i, `${rule.reason} ("${found[0]}")`);
    }
  });

  // The layout: the case's title, every section, and a conclusion left to a person.
  if (lines[0] !== titleOf(meta)) flag(0, "the title is not this case's");
  for (const name of Object.values(SECTIONS)) {
    if (sectionAt(name) === -1) problems.push({ line: 0, text: "", reason: `the ${name} section is missing` });
  }
  const findingsAt = sectionAt(SECTIONS.findings);
  const conclusionAt = sectionAt(SECTIONS.conclusion);
  if (conclusionAt !== -1 && lines[conclusionAt] !== `${SECTIONS.conclusion}: ${FIXED.conclusion}`) {
    flag(conclusionAt, "the conclusion is the radiologist's to write");
  }
  const inFindings = (i: number) => findingsAt !== -1 && i > findingsAt && (conclusionAt === -1 || i < conclusionAt);

  // Outside the findings, the only numbers are the case's own: its image count and slice thickness.
  const caseNumbers = new Set([String(total)]);
  if (meta.geometry.sliceThicknessMm) caseNumbers.add(format.thickness(meta.geometry.sliceThicknessMm));
  lines.forEach((line, i) => {
    if (inFindings(i)) return;
    for (const n of numbersIn(line)) if (!caseNumbers.has(n)) flag(i, `the number ${n} is not in the findings`);
  });

  // Each findings line: a template organ, saying only what its own findings support.
  const byHeading = itemsByHeading(items);
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    if (!inFindings(i) || line.trim() === "") return;
    const parsed = /^([^:]+):\s*(.*)$/.exec(line);
    if (!parsed) return flag(i, "a findings line without an organ");
    const [, heading, content] = parsed;
    const group = ORGAN_GROUPS.find((g) => g.heading === heading);
    if (!group && heading !== OTHER_HEADING) return flag(i, `"${heading}" is not an organ line of the template`);
    if (seen.has(heading)) flag(i, `${heading} has more than one line`);
    seen.add(heading);

    const found = byHeading.get(heading) ?? [];
    const allowed = numbersOf(found, total);
    for (const n of numbersIn(content)) if (!allowed.has(n)) flag(i, `the number ${n} is not in this organ's findings`);
    for (const [side, pattern] of Object.entries(SIDE_WORDS)) {
      if (pattern.test(content) && !found.some((f) => f.side === side)) flag(i, `says ${side}, which no finding here is`);
    }
    for (const [pole, pattern] of Object.entries(POLE_PATTERNS)) {
      if (pattern.test(content) && !found.some((f) => f.pole === pole)) flag(i, `names the ${pole} pole, where no finding here is`);
    }
    for (const [organ, pattern] of Object.entries(ORGAN_PATTERNS)) {
      if (pattern.test(content) && !found.some((f) => f.organ === organ)) flag(i, `names the ${organ}, which no finding here is in`);
    }
    if (NEGATIVE.test(content) && !(group && source.assessed.includes(group.id))) {
      flag(i, "says something is not there, in an organ that was not assessed");
    }
    for (const f of found) {
      if (!content.includes(`image ${format.image(f.slice)} of ${total}`)) {
        flag(i, `leaves out the finding on image ${format.image(f.slice)}`);
      }
    }
  });

  // A finding whose line is missing altogether.
  for (const [heading, found] of byHeading) {
    if (seen.has(heading)) continue;
    for (const f of found) {
      problems.push({ line: 0, text: "", reason: `leaves out the finding on image ${format.image(f.slice)} (${heading})` });
    }
  }
  return problems;
}
