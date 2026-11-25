import type { CaseIndex, CaseMeta, Truth } from "./types";

/** Where cases are served from. Defaults to this site's /cases/; set
 *  VITE_CASES_URL to read them from a bucket instead (docs/deploying.md). */
export const CASES_URL: string = (() => {
  const configured = import.meta.env.VITE_CASES_URL as string | undefined;
  const base = configured || `${import.meta.env.BASE_URL}cases/`;
  const absolute = new URL(base, window.location.href).href;
  return absolute.endsWith("/") ? absolute : `${absolute}/`;
})();

export function caseUrl(caseId: string, path: string): string {
  return new URL(`${caseId}/${path}`, CASES_URL).href;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

export const loadIndex = () => getJson<CaseIndex>(new URL("index.json", CASES_URL).href);
export const loadCase = (id: string) => getJson<CaseMeta>(caseUrl(id, "case.json"));
export const loadTruth = (meta: CaseMeta) => getJson<Truth>(caseUrl(meta.id, meta.truth ?? "truth.json"));

/**
 * The label volume (one byte per voxel, tens of MB). It is kept in a private
 * field so it never appears as a plain prop: React's development build copies
 * props into its performance tracks, and copying a 68 MB array that way runs
 * the tab out of memory.
 */
export class LabelVolume {
  readonly #data: Uint8Array;
  constructor(data: Uint8Array) {
    this.#data = data;
  }
  get data(): Uint8Array {
    return this.#data;
  }
}

/** The label volume, slice by slice. Some hosts decompress .gz on the way
 *  (Content-Encoding: gzip) and some do not, so look at the bytes. */
export async function loadLabels(meta: CaseMeta, truth: Truth): Promise<LabelVolume> {
  const response = await fetch(caseUrl(meta.id, truth.labels.file));
  if (!response.ok) throw new Error(`labels: ${response.status}`);
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const [slices, rows, cols] = truth.labels.shape;
  if (bytes.length !== slices * rows * cols) {
    throw new Error(`labels: expected ${slices * rows * cols} bytes, got ${bytes.length}`);
  }
  return new LabelVolume(bytes);
}
