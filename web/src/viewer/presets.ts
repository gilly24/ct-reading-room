/** Window presets, as on a reporting workstation. Keys 1-4 choose them. */
export const PRESETS = [
  { key: "1", name: "Abdomen", width: 400, center: 40 },
  { key: "2", name: "Liver", width: 150, center: 90 },
  { key: "3", name: "Bone", width: 1800, center: 400 },
  { key: "4", name: "Lung", width: 1500, center: -600 },
] as const;

export type Preset = (typeof PRESETS)[number];
