// Geometry for the three views (axial, coronal, sagittal): where their planes
// cross, where each view draws the other two as lines, and which way the
// patient faces on screen. Pure, so it is tested without a browser.
//
// World coordinates are DICOM patient coordinates (LPS): +x is the patient's
// left, +y their back, +z their head.

export type Vec3 = readonly [number, number, number];
export type Point2 = readonly [number, number];
export type Plane = { normal: Vec3; point: Vec3 };
export type ViewName = "axial" | "coronal" | "sagittal";

export const VIEWS: readonly ViewName[] = ["axial", "coronal", "sagittal"];

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length === 0 ? a : scale(a, 1 / length);
}

/** The one point on all three planes, or null if two of them are parallel. */
export function meetingPoint(a: Plane, b: Plane, c: Plane): Vec3 | null {
  const bc = cross(b.normal, c.normal);
  const det = dot(a.normal, bc);
  if (Math.abs(det) < 1e-9) return null;
  const sum = add(
    add(scale(bc, dot(a.normal, a.point)), scale(cross(c.normal, a.normal), dot(b.normal, b.point))),
    scale(cross(a.normal, b.normal), dot(c.normal, c.point)),
  );
  return scale(sum, 1 / det);
}

/** How far a plane has to move along its normal to pass through a point. */
export function offsetTo(plane: Plane, target: Vec3): number {
  return dot(sub(target, plane.point), normalize(plane.normal));
}

/** Distance in pixels from p to the line through a and b (not just the segment). */
export function distanceToLine(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / length;
}

/** The patient direction a world vector points in, as the letter shown at the edge of the image. */
export function directionLetter(v: Vec3): string {
  const [x, y, z] = v.map(Math.abs);
  if (x >= y && x >= z) return v[0] > 0 ? "L" : "R";
  if (y >= z) return v[1] > 0 ? "P" : "A";
  return v[2] > 0 ? "S" : "I";
}

/** Which of the three standard planes a view's normal is closest to. */
export function planeName(normal: Vec3): ViewName {
  const [x, y, z] = normal.map(Math.abs);
  if (z >= x && z >= y) return "axial";
  return y >= x ? "coronal" : "sagittal";
}

/** The slice whose plane is nearest a point, for evenly spaced slices from `first` to `last`. */
export function nearestSlice(point: Vec3, first: Vec3, last: Vec3, count: number): number {
  if (count <= 1) return 0;
  const axis = sub(last, first);
  const span = dot(axis, axis);
  if (span === 0) return 0;
  const t = dot(sub(point, first), axis) / span;
  return Math.max(0, Math.min(count - 1, Math.round(t * (count - 1))));
}

/** Where a value sits between two ends, from 0 at the smaller end to 1 at the larger. */
export function fraction(value: number, a: number, b: number): number {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  if (high === low) return 0.5;
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}
