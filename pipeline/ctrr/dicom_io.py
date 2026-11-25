"""Reading a CT series from DICOM files into one ordered volume."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pydicom
from pydicom.dataset import Dataset

CT_IMAGE_STORAGE = "1.2.840.10008.5.1.4.1.1.2"
ENHANCED_CT_IMAGE_STORAGE = "1.2.840.10008.5.1.4.1.1.2.1"


@dataclass
class CtSeries:
    """One axial CT series, ordered head first (index 0 is the most superior slice)."""

    paths: list[Path]
    datasets: list[Dataset]
    hu: np.ndarray  # (slices, rows, columns), float32 Hounsfield units
    positions: np.ndarray  # (slices, 3) ImagePositionPatient, LPS mm
    row_direction: np.ndarray  # direction of increasing column index
    column_direction: np.ndarray  # direction of increasing row index
    pixel_spacing: tuple[float, float]  # (between rows, between columns) in mm
    slice_spacing: float  # mm between slice centres
    slice_thickness: float | None

    @property
    def shape(self) -> tuple[int, int, int]:
        return tuple(self.hu.shape)  # type: ignore[return-value]

    @property
    def sop_instance_uids(self) -> list[str]:
        return [str(ds.SOPInstanceUID) for ds in self.datasets]

    @property
    def series_instance_uid(self) -> str:
        return str(self.datasets[0].SeriesInstanceUID)

    @property
    def voxel_volume_mm3(self) -> float:
        return self.pixel_spacing[0] * self.pixel_spacing[1] * self.slice_spacing

    def to_world(self, slice_index: float, row: float, col: float) -> np.ndarray:
        """Patient (LPS) coordinates in mm of a voxel position, fractional indices allowed."""
        lower = int(np.floor(slice_index))
        upper = min(lower + 1, len(self.positions) - 1)
        frac = slice_index - lower
        origin = self.positions[lower] * (1 - frac) + self.positions[upper] * frac
        return (
            origin
            + self.row_direction * (col * self.pixel_spacing[1])
            + self.column_direction * (row * self.pixel_spacing[0])
        )


def find_dicom_files(directory: Path) -> list[Path]:
    return sorted(p for p in Path(directory).rglob("*") if p.is_file() and _looks_like_dicom(p))


def _looks_like_dicom(path: Path) -> bool:
    if path.suffix.lower() == ".dcm":
        return True
    try:
        with open(path, "rb") as f:
            f.seek(128)
            return f.read(4) == b"DICM"
    except OSError:
        return False


def load_ct_series(paths: list[Path]) -> CtSeries:
    """Read single-frame CT instances of one series and order them head first.

    Refuses anything that is not a plain axial stack with one geometry, because the
    web viewer and the label volume both assume one.
    """
    if not paths:
        raise ValueError("no DICOM files given")

    datasets = [pydicom.dcmread(p) for p in paths]
    series_uids = {str(ds.SeriesInstanceUID) for ds in datasets}
    if len(series_uids) != 1:
        raise ValueError(f"expected one series, found {len(series_uids)}")
    for ds in datasets:
        if str(ds.SOPClassUID) != CT_IMAGE_STORAGE:
            raise ValueError(f"{ds.SOPClassUID} is not single-frame CT Image Storage")

    orientation = np.array(datasets[0].ImageOrientationPatient, dtype=float)
    row_dir, col_dir = orientation[:3], orientation[3:]
    normal = np.cross(row_dir, col_dir)
    if abs(normal[2]) < 0.9:
        raise ValueError("only axial series are supported")

    for ds in datasets:
        if not np.allclose(np.array(ds.ImageOrientationPatient, dtype=float), orientation, atol=1e-3):
            raise ValueError("slices have different orientations")

    spacing = tuple(float(v) for v in datasets[0].PixelSpacing)
    rows, cols = int(datasets[0].Rows), int(datasets[0].Columns)
    for ds in datasets:
        if (int(ds.Rows), int(ds.Columns)) != (rows, cols):
            raise ValueError("slices have different sizes")
        if not np.allclose([float(v) for v in ds.PixelSpacing], spacing, atol=1e-3):
            raise ValueError("slices have different pixel spacing")

    # Head first: sort by patient z (LPS +z is superior), highest first.
    order = sorted(range(len(datasets)), key=lambda i: -float(datasets[i].ImagePositionPatient[2]))
    datasets = [datasets[i] for i in order]
    paths = [paths[i] for i in order]
    positions = np.array([[float(v) for v in ds.ImagePositionPatient] for ds in datasets])

    zs = positions[:, 2]
    if len(set(np.round(zs, 3))) != len(zs):
        raise ValueError("two slices share a position")
    gaps = -np.diff(zs)
    slice_spacing = float(np.median(gaps)) if len(gaps) else float(getattr(datasets[0], "SliceThickness", 1.0))
    if len(gaps) and (gaps.max() - gaps.min()) > 0.1 * slice_spacing + 0.01:
        raise ValueError("slices are not evenly spaced")

    hu = np.stack([_to_hu(ds) for ds in datasets]).astype(np.float32)
    thickness = getattr(datasets[0], "SliceThickness", None)

    return CtSeries(
        paths=paths,
        datasets=datasets,
        hu=hu,
        positions=positions,
        row_direction=row_dir,
        column_direction=col_dir,
        pixel_spacing=(spacing[0], spacing[1]),
        slice_spacing=slice_spacing,
        slice_thickness=float(thickness) if thickness not in (None, "") else None,
    )


def _to_hu(ds: Dataset) -> np.ndarray:
    pixels = ds.pixel_array.astype(np.float32)
    slope = float(getattr(ds, "RescaleSlope", 1) or 1)
    intercept = float(getattr(ds, "RescaleIntercept", 0) or 0)
    return pixels * slope + intercept
