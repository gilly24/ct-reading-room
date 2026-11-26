"""NIfTI in and out, for the AI model.

nnU-Net reads CT and writes its outlines as NIfTI (.nii.gz), through SimpleITK.
Our volumes are head first (index 0 is the most superior slice); NIfTI files
here run the other way, feet to head, so the axes form an ordinary right-handed
frame. Everything goes through these functions, so the two orders never meet
anywhere else.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import SimpleITK as sitk

from .dicom_io import CtSeries

# How far a prediction's geometry may be from its CT's and still be the same grid.
TOLERANCE_MM = 0.01


def _image(volume: np.ndarray, ct: CtSeries) -> sitk.Image:
    """A head-first (slice, row, column) volume as an image with the CT's geometry."""
    if volume.shape != ct.shape:
        raise ValueError(f"volume {volume.shape} does not match the CT {ct.shape}")
    image = sitk.GetImageFromArray(np.ascontiguousarray(volume[::-1]))
    slices = len(ct.positions)
    if slices > 1:
        up = ct.positions[0] - ct.positions[-1]
        slice_direction = up / np.linalg.norm(up)
    else:
        slice_direction = np.cross(ct.row_direction, ct.column_direction)
    # SimpleITK's axes are (column, row, slice); each column of the matrix is one axis's direction.
    direction = np.column_stack([ct.row_direction, ct.column_direction, slice_direction])
    image.SetDirection([float(v) for v in direction.flatten()])
    image.SetSpacing((float(ct.pixel_spacing[1]), float(ct.pixel_spacing[0]), float(ct.slice_spacing)))
    image.SetOrigin([float(v) for v in ct.positions[-1]])
    return image


def write_ct(ct: CtSeries, path: Path) -> Path:
    """The CT in Hounsfield units, as nnU-Net expects its input (int16 keeps it small)."""
    hu = np.clip(np.round(ct.hu), -32768, 32767).astype(np.int16)
    sitk.WriteImage(_image(hu, ct), str(path), useCompression=True)
    return Path(path)


def write_labels(labels: np.ndarray, ct: CtSeries, path: Path) -> Path:
    """A head-first label volume as NIfTI on the CT's grid: training targets, and tests."""
    sitk.WriteImage(_image(labels.astype(np.uint8), ct), str(path), useCompression=True)
    return Path(path)


def read_labels(path: Path, ct: CtSeries) -> np.ndarray:
    """A label NIfTI (a model's prediction) back as a head-first uint8 volume.

    Refuses one that is not on the CT's grid: a prediction for another scan, or one
    resampled on the way, would otherwise be measured as if it were this one.
    """
    image = sitk.ReadImage(str(path))
    expected = _image(np.zeros(ct.shape, dtype=np.uint8), ct)
    if image.GetSize() != expected.GetSize():
        raise ValueError(f"{path}: size {image.GetSize()}, the CT's is {expected.GetSize()}")
    checks = {
        "spacing": (image.GetSpacing(), expected.GetSpacing()),
        "origin": (image.GetOrigin(), expected.GetOrigin()),
        "direction": (image.GetDirection(), expected.GetDirection()),
    }
    for name, (got, want) in checks.items():
        if not np.allclose(got, want, atol=TOLERANCE_MM):
            raise ValueError(f"{path}: {name} {tuple(round(v, 4) for v in got)} is not the CT's {want}")
    values = sitk.GetArrayFromImage(image)
    if not np.issubdtype(values.dtype, np.integer):
        if not np.array_equal(values, np.round(values)):
            raise ValueError(f"{path}: labels must be whole numbers")
    if values.min() < 0 or values.max() > 255:
        raise ValueError(f"{path}: label values must be 0 to 255")
    return np.ascontiguousarray(values[::-1].astype(np.uint8))
