"""Measurements on hand-made label volumes, where the right answer is known exactly."""

from pathlib import Path

import numpy as np

from ctrr.dicom_io import CtSeries
from ctrr.findings import measure_lesions
from ctrr.seg_io import CLASS_VALUE, class_for_segment


def _ct(shape=(10, 64, 64), spacing=(1.0, 1.0), slice_mm=2.0) -> CtSeries:
    n = shape[0]
    hu = np.full(shape, -1000.0, dtype=np.float32)
    hu[:, 8:56, 8:56] = 40  # a square "body" so the midline is the image centre
    return CtSeries(
        paths=[Path(f"{i}.dcm") for i in range(n)],
        datasets=[],
        hu=hu,
        positions=np.array([[-31.5, -31.5, -i * slice_mm] for i in range(n)]),
        row_direction=np.array([1.0, 0, 0]),
        column_direction=np.array([0, 1.0, 0]),
        pixel_spacing=spacing,
        slice_spacing=slice_mm,
        slice_thickness=slice_mm,
    )


def test_a_rectangle_is_measured_corner_to_corner():
    ct = _ct()
    labels = np.zeros(ct.shape, dtype=np.uint8)
    labels[4:7, 20:30, 40:46] = CLASS_VALUE["tumour"]  # 10 x 6 pixels, 3 slices
    (lesion,) = measure_lesions(labels, ct)
    assert abs(lesion.long_axis.length_mm - np.hypot(9, 5) - 1) < 1e-6
    assert lesion.slice_range == (4, 6)
    assert abs(lesion.volume_cm3 - 10 * 6 * 3 * 2 / 1000) < 1e-9
    assert lesion.side == "left"  # columns 40+ are on the patient's left


def test_specks_are_not_lesions():
    ct = _ct()
    labels = np.zeros(ct.shape, dtype=np.uint8)
    labels[5, 30, 30] = CLASS_VALUE["tumour"]
    assert measure_lesions(labels, ct) == []


def test_two_separate_tumours_are_numbered_by_size():
    ct = _ct()
    labels = np.zeros(ct.shape, dtype=np.uint8)
    labels[2:4, 10:14, 10:14] = CLASS_VALUE["tumour"]
    labels[5:9, 30:40, 30:40] = CLASS_VALUE["tumour"]
    first, second = measure_lesions(labels, ct)
    assert (first.id, second.id) == ("T1", "T2")
    assert first.volume_cm3 > second.volume_cm3


def test_segment_names_from_real_datasets():
    assert class_for_segment("Kidney", "Kidney") == "kidney"
    assert class_for_segment("Mass", "Mass") == "tumour"  # how C4KC-KiTS names its tumours
    assert class_for_segment("Tumour", "Neoplasm") == "tumour"
    assert class_for_segment("Renal cyst", "Cyst") == "cyst"
    assert class_for_segment("Aorta", "Aorta") is None
