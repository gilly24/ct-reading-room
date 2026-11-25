// Label values in labels.u8.gz. Same table as pipeline/ctrr/seg_io.py CLASSES.

export const CLASS_COLOURS: Record<string, [number, number, number]> = {
  kidney: [95, 180, 255],
  tumour: [255, 120, 50],
  cyst: [120, 230, 200],
  liver: [180, 140, 255],
  pancreas: [255, 210, 90],
  spleen: [240, 110, 180],
};

export const LESION_COLOURS = {
  tumour: "#ff8a3d",
  cyst: "#6fe3c4",
  mark: "#ffd84d",
} as const;
