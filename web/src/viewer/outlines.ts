// The reference outlines, drawn by us rather than by Cornerstone's segmentation
// layer: only the slice on screen is ever turned into pixels, so a 500-slice
// case costs the label volume and one 512 x 512 canvas, not a labelmap per slice.

import { CLASS_COLOURS } from "../case/classes";

const NAMES = ["", "kidney", "tumour", "cyst", "liver", "pancreas", "spleen"];
const LESION = new Set(["tumour", "cyst"]);

const COLOURS: [number, number, number][] = NAMES.map((name) => CLASS_COLOURS[name] ?? [0, 0, 0]);

/** One slice of the label volume as an image: solid edges, faint fill. */
export function rasteriseSlice(labels: Uint8Array, slice: number, rows: number, cols: number): HTMLCanvasElement {
  const offset = slice * rows * cols;
  const image = new ImageData(cols, rows);
  const px = image.data;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const v = labels[offset + i];
      if (v === 0 || v >= COLOURS.length) continue;
      const edge =
        c === 0 || c === cols - 1 || r === 0 || r === rows - 1 ||
        labels[offset + i - 1] !== v || labels[offset + i + 1] !== v ||
        labels[offset + i - cols] !== v || labels[offset + i + cols] !== v;
      const [red, green, blue] = COLOURS[v];
      const o = i * 4;
      px[o] = red;
      px[o + 1] = green;
      px[o + 2] = blue;
      px[o + 3] = edge ? 235 : LESION.has(NAMES[v]) ? 70 : 22;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  return canvas;
}

/** Maps image pixel (col, row) to canvas CSS pixels: x = a*col + c*row + e, y = b*col + d*row + f. */
export type PixelTransform = [number, number, number, number, number, number];

export function paintOutlines(target: HTMLCanvasElement, slice: HTMLCanvasElement | null, transform: PixelTransform | null) {
  const rect = target.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (target.width !== width || target.height !== height) {
    target.width = width;
    target.height = height;
  }
  const ctx = target.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!slice || !transform) return;
  const [a, b, c, d, e, f] = transform;
  ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
  ctx.imageSmoothingEnabled = false;
  // Pixel (col, row) is centred on (col, row), so its square starts half a pixel before.
  ctx.drawImage(slice, -0.5, -0.5);
}

/** Keeps the last few rasterised slices, so scrolling back and forth stays cheap. */
export class SliceCache {
  private entries = new Map<number, HTMLCanvasElement>();
  constructor(private labels: Uint8Array, private rows: number, private cols: number, private size = 12) {}

  get(slice: number): HTMLCanvasElement {
    let canvas = this.entries.get(slice);
    if (canvas) {
      this.entries.delete(slice);
    } else {
      canvas = rasteriseSlice(this.labels, slice, this.rows, this.cols);
      if (this.entries.size >= this.size) this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(slice, canvas);
    return canvas;
  }

  holds(labels: Uint8Array): boolean {
    return this.labels === labels;
  }
}
