"""Turning a label volume into a list of measured lesions, the way a radiologist reports them."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
from scipy import ndimage
from scipy.spatial import ConvexHull, QhullError

from .dicom_io import CtSeries
from .seg_io import CLASS_VALUE, CLASSES, ORGAN_CLASSES

# Below this a component is an outlining speck, not a lesion anyone would report.
MIN_LESION_VOLUME_MM3 = 50.0


@dataclass
class Axis:
    slice: int
    start: tuple[float, float]  # (row, col)
    end: tuple[float, float]
    length_mm: float


@dataclass
class Lesion:
    id: str
    kind: str  # "tumour" or "cyst"
    organ: str | None
    side: str | None  # "left" or "right", the patient's side
    pole: str | None  # kidney only: "upper", "interpolar", "lower"
    slice_range: tuple[int, int]
    key_slice: int
    long_axis: Axis
    short_axis_mm: float
    volume_cm3: float
    mean_hu: float
    centroid_world: tuple[float, float, float]
    boxes: list[tuple[int, int, int, int, int]] = field(default_factory=list)  # (slice, r0, c0, r1, c1)

    def to_json(self) -> dict:
        d = asdict(self)
        return {
            "id": d["id"],
            "kind": d["kind"],
            "organ": d["organ"],
            "side": d["side"],
            "pole": d["pole"],
            "sliceRange": list(d["slice_range"]),
            "keySlice": d["key_slice"],
            "longAxisMm": round(d["long_axis"]["length_mm"], 1),
            "shortAxisMm": round(d["short_axis_mm"], 1),
            "volumeCm3": round(d["volume_cm3"], 2),
            "meanHu": round(d["mean_hu"]),
            "longAxis": {
                "slice": d["long_axis"]["slice"],
                "from": [round(v, 1) for v in d["long_axis"]["start"]],
                "to": [round(v, 1) for v in d["long_axis"]["end"]],
            },
            "centroidWorld": [round(v, 1) for v in d["centroid_world"]],
            "boxes": [list(b) for b in d["boxes"]],
        }


def measure_lesions(labels: np.ndarray, ct: CtSeries, kinds: tuple[str, ...] = ("tumour", "cyst")) -> list[Lesion]:
    """Every separate lesion of the given kinds, largest first within each kind."""
    midline_x = body_midline_x(ct)
    lesions: list[Lesion] = []
    for kind in kinds:
        found = _measure_kind(labels, ct, kind, midline_x)
        found.sort(key=lambda l: -l.volume_cm3)
        prefix = "T" if kind == "tumour" else "C"
        for i, lesion in enumerate(found, start=1):
            lesion.id = f"{prefix}{i}"
        lesions.extend(found)
    return lesions


def _measure_kind(labels: np.ndarray, ct: CtSeries, kind: str, midline_x: float) -> list[Lesion]:
    mask = labels == CLASS_VALUE[kind]
    components, count = ndimage.label(mask, structure=np.ones((3, 3, 3), dtype=bool))
    out: list[Lesion] = []
    for index, sl in enumerate(ndimage.find_objects(components), start=1):
        if sl is None:
            continue
        component = components[sl] == index
        voxels = int(component.sum())
        volume_mm3 = voxels * ct.voxel_volume_mm3
        if volume_mm3 < MIN_LESION_VOLUME_MM3:
            continue

        offset = np.array([s.start for s in sl])
        coords = np.argwhere(component) + offset
        centroid = coords.mean(axis=0)
        centroid_world = ct.to_world(*centroid)

        long_axis, short_axis = _longest_axial_diameter(component, offset, ct.pixel_spacing)
        organ = _host_organ(labels, components == index)
        side = "left" if centroid_world[0] > midline_x else "right"

        boxes = []
        for z in range(component.shape[0]):
            rows, cols = np.nonzero(component[z])
            if len(rows):
                boxes.append(
                    (int(z + offset[0]), int(rows.min() + offset[1]), int(cols.min() + offset[2]),
                     int(rows.max() + offset[1]), int(cols.max() + offset[2]))
                )

        out.append(
            Lesion(
                id="",
                kind=kind,
                organ=organ,
                side=side,
                pole=_kidney_pole(labels, ct, midline_x, side, centroid[0]) if organ == "kidney" else None,
                slice_range=(int(sl[0].start), int(sl[0].stop - 1)),
                key_slice=long_axis.slice,
                long_axis=long_axis,
                short_axis_mm=short_axis,
                volume_cm3=volume_mm3 / 1000.0,
                mean_hu=float(ct.hu[components == index].mean()),
                centroid_world=tuple(float(v) for v in centroid_world),
                boxes=boxes,
            )
        )
    return out


def _longest_axial_diameter(
    component: np.ndarray, offset: np.ndarray, spacing: tuple[float, float]
) -> tuple[Axis, float]:
    """RECIST-style: the longest in-plane diameter on any slice, and the widest
    perpendicular to it on that same slice. Measured edge to edge, so a lesion
    one pixel wide is one pixel spacing long, not zero."""
    best: tuple[float, int, np.ndarray, np.ndarray, np.ndarray] | None = None
    for z in range(component.shape[0]):
        plane = component[z]
        if not plane.any():
            continue
        points = np.argwhere(plane).astype(float)
        mm = points * np.array(spacing)
        hull_points = _hull(mm)
        a, b, length = _farthest_pair(hull_points)
        if best is None or length > best[0]:
            best = (length, z, a, b, mm)
    assert best is not None
    length, z, a, b, mm = best

    pad = float(np.mean(spacing))
    direction = (b - a) / length if length > 0 else np.array([1.0, 0.0])
    perpendicular = np.array([-direction[1], direction[0]])
    projections = mm @ perpendicular
    short = float(projections.max() - projections.min()) + pad

    start = a / np.array(spacing)
    end = b / np.array(spacing)
    axis = Axis(
        slice=int(z + offset[0]),
        start=(float(start[0] + offset[1]), float(start[1] + offset[2])),
        end=(float(end[0] + offset[1]), float(end[1] + offset[2])),
        length_mm=float(length) + pad,
    )
    return axis, min(short, axis.length_mm)


def _hull(points: np.ndarray) -> np.ndarray:
    if len(points) < 3:
        return points
    try:
        return points[ConvexHull(points).vertices]
    except QhullError:  # all on one line
        return points


def _farthest_pair(points: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    if len(points) == 1:
        return points[0], points[0], 0.0
    d = np.linalg.norm(points[:, None, :] - points[None, :, :], axis=-1)
    i, j = np.unravel_index(np.argmax(d), d.shape)
    return points[i], points[j], float(d[i, j])


def _host_organ(labels: np.ndarray, lesion: np.ndarray) -> str | None:
    """The organ the lesion touches most, looking a couple of voxels around it."""
    around = ndimage.binary_dilation(lesion, structure=np.ones((3, 3, 3), dtype=bool), iterations=2) & ~lesion
    values, counts = np.unique(labels[around], return_counts=True)
    best, best_count = None, 0
    for value, n in zip(values, counts):
        name = CLASSES.get(int(value))
        if name in ORGAN_CLASSES and n > best_count:
            best, best_count = name, int(n)
    return best


def _kidney_pole(labels: np.ndarray, ct: CtSeries, midline_x: float, side: str, centroid_slice: float) -> str | None:
    """Upper, middle or lower third of that kidney's length, counting the lesion as kidney."""
    kidney_like = np.isin(labels, [CLASS_VALUE["kidney"], CLASS_VALUE["tumour"], CLASS_VALUE["cyst"]])
    slices = []
    for z in np.nonzero(kidney_like.any(axis=(1, 2)))[0]:
        rows, cols = np.nonzero(kidney_like[z])
        xs = np.array([ct.to_world(z, r, c)[0] for r, c in zip(rows[::50], cols[::50])])
        on_side = (xs > midline_x) if side == "left" else (xs <= midline_x)
        if on_side.any():
            slices.append(z)
    if not slices:
        return None
    top, bottom = min(slices), max(slices)  # slice 0 is the most superior
    if bottom == top:
        return "interpolar"
    fraction = (centroid_slice - top) / (bottom - top)
    if fraction < 1 / 3:
        return "upper"
    if fraction > 2 / 3:
        return "lower"
    return "interpolar"


def body_midline_x(ct: CtSeries) -> float:
    """Patient x (LPS) of the middle of the body, from the largest body outline mid-scan."""
    z = ct.shape[0] // 2
    body = ct.hu[z] > -500
    components, count = ndimage.label(body)
    if count == 0:
        return float(ct.to_world(z, ct.shape[1] / 2, ct.shape[2] / 2)[0])
    sizes = ndimage.sum(body, components, range(1, count + 1))
    largest = components == (int(np.argmax(sizes)) + 1)
    rows, cols = np.nonzero(largest)
    return float(ct.to_world(z, rows.mean(), cols.mean())[0])
