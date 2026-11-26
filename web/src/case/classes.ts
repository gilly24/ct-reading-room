// Label values in labels.u8.gz. Same table as pipeline/ctrr/seg_io.py CLASSES.

export const CLASS_COLOURS: Record<string, [number, number, number]> = {
  kidney: [95, 180, 255],
  tumour: [255, 120, 50],
  cyst: [120, 230, 200],
  liver: [150, 190, 90], // not violet: that is the AI's colour
  pancreas: [255, 210, 90],
  spleen: [240, 110, 180],
};

export const LESION_COLOURS = {
  tumour: "#ff8a3d",
  cyst: "#6fe3c4",
  mark: "#ffd84d",
} as const;

/** The AI's layer: one colour no class, measurement or crosshair line uses. Its outlines are dotted. */
export const AI_COLOUR = "#9b8cff";
export const AI_RGB: [number, number, number] = [155, 140, 255];
