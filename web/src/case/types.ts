// The files a case is made of. docs/case-format.md describes them, and
// pipeline/ctrr/bundle.py writes them; change all three together.

export type CaseSummary = {
  id: string;
  title: string;
  description: string;
  slices: number;
  dataset: string | null;
  hasAi: boolean;
};

export type CaseIndex = { schema: 1; cases: CaseSummary[] };

export type CaseSource = {
  dataset: string;
  collection: string | null;
  citation: string;
  url: string | null;
  licence: string;
  patient?: string;
  doi?: string;
};

export type CaseMeta = {
  schema: 1;
  id: string;
  title: string;
  modality: "CT";
  description: string;
  patient: { age?: number; sex?: "M" | "F" };
  geometry: {
    rows: number;
    columns: number;
    slices: number;
    pixelSpacingMm: [number, number];
    sliceSpacingMm: number;
    sliceThicknessMm: number | null;
    order: "head-first";
  };
  window: { center: number; width: number };
  /** CT files, one DICOM per slice, head first. The pipeline writes them as lossless
   *  HTJ2K; the loader reads each file's transfer syntax, so older uncompressed bundles open too. */
  images: string[];
  source: CaseSource;
  truth: string | null;
  ai: string | null;
};

/** (row, column) in pixels on one slice. */
export type PixelPoint = [number, number];

export type Lesion = {
  id: string;
  kind: "tumour" | "cyst";
  organ: string | null;
  side: "left" | "right" | null;
  pole: "upper" | "interpolar" | "lower" | null;
  sliceRange: [number, number];
  keySlice: number;
  longAxisMm: number;
  shortAxisMm: number;
  volumeCm3: number;
  meanHu: number;
  longAxis: { slice: number; from: PixelPoint; to: PixelPoint };
  centroidWorld: [number, number, number];
  /** [slice, row0, col0, row1, col1], one per slice the lesion is on. */
  boxes: [number, number, number, number, number][];
};

export type LabelFile = {
  file: string;
  encoding: string;
  shape: [number, number, number];
  classes: Record<string, string>;
};

export type Truth = {
  schema: 1;
  caseId: string;
  note: string;
  labels: LabelFile;
  lesions: Lesion[];
};

/** ai.json: a model's outlines of the case, measured by the same code as the reference. */
export type AiFindings = {
  schema: 1;
  caseId: string;
  model: {
    name: string;
    version: string;
    architecture: string;
    trainedOn: { dataset: string; patients: number };
    /** Every class the model can output, whether or not this case has any: what the AI looked for. */
    outlines: string[];
    /** Path of the model card in the repository, or null. */
    card: string | null;
  };
  /** Always true: the pipeline refuses to write findings for a patient the model trained on. */
  heldOut: true;
  note: string;
  labels: LabelFile;
  files: { seg?: string };
  lesions: Lesion[];
};
