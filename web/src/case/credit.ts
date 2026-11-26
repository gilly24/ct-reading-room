// Links for a case's credit line, from the fields case.json already has.
import { REPO_URL } from "../site";

/** Where a licence can be read: Creative Commons by its short name, and MIT
 *  (the synthetic phantom's) as this repository's own licence. Otherwise null. */
export function licenceUrl(licence: string): string | null {
  const name = licence.trim();
  const cc = name.match(/^CC[ -]BY((?:-(?:NC|SA|ND))*)[ -](\d\.\d)$/i);
  if (cc) return `https://creativecommons.org/licenses/by${cc[1].toLowerCase()}/${cc[2]}/`;
  if (name === "MIT") return `${REPO_URL}/blob/main/LICENSE`;
  return null;
}

export type CitationPart = { text: string; href?: string };

/** The citation in pieces, its web addresses (the DOI among them) as links. */
export function citationParts(citation: string): CitationPart[] {
  const parts: CitationPart[] = [];
  let from = 0;
  // A full stop or comma right after an address ends the sentence, not the address.
  for (const m of citation.matchAll(/https?:\/\/\S+?(?=[.,;:)]?(?:\s|$))/g)) {
    if (m.index > from) parts.push({ text: citation.slice(from, m.index) });
    parts.push({ text: m[0], href: m[0] });
    from = m.index + m[0].length;
  }
  if (from < citation.length) parts.push({ text: citation.slice(from) });
  return parts;
}
