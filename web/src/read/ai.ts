import type { Lesion } from "../case/types";
import type { Mark } from "./marks";

export const AI_MARK_PREFIX = "ai-";

/**
 * The AI's findings as marks: each lesion's long axis, as if a reader had drawn
 * it. Scoring them with scoreRead holds the AI to exactly the rules the reader is held to.
 */
export function marksFromLesions(lesions: Lesion[]): Mark[] {
  return lesions.map((lesion) => ({
    id: `${AI_MARK_PREFIX}${lesion.id}`,
    slice: lesion.longAxis.slice,
    from: lesion.longAxis.from,
    to: lesion.longAxis.to,
    lengthMm: lesion.longAxisMm,
    side: lesion.side,
    kind: lesion.kind,
  }));
}
