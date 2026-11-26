"""NIfTI in and out, for the AI model.

nnU-Net reads CT and writes its outlines as NIfTI (.nii.gz) through SimpleITK,
and it uses the array as it finds it: it does not reorient. So a case's CT must
be written exactly as the training set was (train_data.py): head first, array
slice 0 the most superior, int16 Hounsfield units, with train_data.ct_geometry's
origin, spacing and direction. Both go through the same functions here, so the
model never reads a scan the other way up from the ones it learned on.

Needs the `train` extra (SimpleITK): uv sync --extra train
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .dicom_io import CtSeries
from .train_data import ct_geometry, read_geometry, write_nifti

# How far a prediction's geometry may be from its CT's and still be the same grid.
TOLERANCE_MM = 0.01


def write_ct(ct: CtSeries, path: Path) -> Path:
    """The CT in Hounsfield units, in the training set's format: nnU-Net's <case>_0000.nii.gz."""
    hu = np.round(ct.hu)
    if hu.min() < np.iinfo(np.int16).min or hu.max() > np.iinfo(np.int16).max:
        raise ValueError(f"HU range {hu.min():.0f}..{hu.max():.0f} does not fit int16")
    write_nifti(hu.astype(np.int16), ct_geometry(ct), Path(path))
    return Path(path)


def write_labels(labels: np.ndarray, ct: CtSeries, path: Path) -> Path:
    """A head-first label volume as NIfTI on the CT's grid: what a model's prediction looks like."""
    if labels.shape != ct.shape:
        raise ValueError(f"labels {labels.shape} do not match the CT {ct.shape}")
    write_nifti(np.ascontiguousarray(labels, dtype=np.uint8), ct_geometry(ct), Path(path))
    return Path(path)


def read_labels(path: Path, ct: CtSeries) -> np.ndarray:
    """A label NIfTI (a model's prediction) back as a head-first uint8 volume.

    Refuses one that is not on the CT's grid: a prediction for another scan, or one
    resampled on the way, would otherwise be measured as if it were this one.
    """
    import SimpleITK as sitk  # the `train` extra

    size, geometry = read_geometry(Path(path))
    expected = ct_geometry(ct)
    want_size = (ct.shape[2], ct.shape[1], ct.shape[0])
    if tuple(size) != want_size:
        raise ValueError(f"{path}: size {tuple(size)}, the CT's is {want_size}")
    checks = {
        "spacing": (geometry.spacing, expected.spacing),
        "origin": (geometry.origin, expected.origin),
        "direction": (geometry.direction, expected.direction),
    }
    for name, (got, want) in checks.items():
        if not np.allclose(got, want, atol=TOLERANCE_MM):
            raise ValueError(f"{path}: {name} {tuple(round(v, 4) for v in got)} is not the CT's {tuple(want)}")
    values = sitk.GetArrayFromImage(sitk.ReadImage(str(path)))
    if not np.issubdtype(values.dtype, np.integer) and not np.array_equal(values, np.round(values)):
        raise ValueError(f"{path}: labels must be whole numbers")
    if values.min() < 0 or values.max() > 255:
        raise ValueError(f"{path}: label values must be 0 to 255")
    return np.ascontiguousarray(values.astype(np.uint8))
