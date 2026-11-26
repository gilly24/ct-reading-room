"""Reading a DICOM SEG into one class-label volume aligned with its CT series."""

from __future__ import annotations

from pathlib import Path

import highdicom as hd
import numpy as np
from pydicom.sr.codedict import codes

from .dicom_io import CtSeries

# The label values every case uses. The web app has the same table
# (web/src/case/classes.ts); change the two together.
CLASSES: dict[int, str] = {
    1: "kidney",
    2: "tumour",
    3: "cyst",
    4: "liver",
    5: "pancreas",
    6: "spleen",
}
CLASS_VALUE = {name: value for value, name in CLASSES.items()}
LESION_CLASSES = ("tumour", "cyst")
ORGAN_CLASSES = ("kidney", "liver", "pancreas", "spleen")

MORPHOLOGICALLY_ALTERED = hd.sr.CodedConcept("49755003", "SCT", "Morphologically Altered Structure")

# Category and type of each class, for the DICOM SEG files the pipeline writes.
SEGMENT_CODES: dict[str, tuple[hd.sr.CodedConcept, hd.sr.CodedConcept]] = {
    "kidney": (codes.SCT.AnatomicalStructure, codes.SCT.Kidney),
    "tumour": (MORPHOLOGICALLY_ALTERED, codes.SCT.Neoplasm),
    "cyst": (MORPHOLOGICALLY_ALTERED, codes.SCT.Cyst),
    "liver": (codes.SCT.AnatomicalStructure, codes.SCT.Liver),
    "pancreas": (codes.SCT.AnatomicalStructure, codes.SCT.Pancreas),
    "spleen": (codes.SCT.AnatomicalStructure, codes.SCT.Spleen),
}

# When segments overlap, the higher priority wins the voxel.
_PRIORITY = {"tumour": 3, "cyst": 2, "kidney": 1, "liver": 1, "pancreas": 1, "spleen": 1}

_WORDS = [
    ("cyst", "cyst"),
    ("tumor", "tumour"),
    ("tumour", "tumour"),
    ("neoplasm", "tumour"),
    ("mass", "tumour"),
    ("carcinoma", "tumour"),
    ("lesion", "tumour"),
    ("kidney", "kidney"),
    ("renal", "kidney"),
    ("liver", "liver"),
    ("hepatic", "liver"),
    ("pancrea", "pancreas"),
    ("spleen", "spleen"),
]


def class_for_segment(label: str, property_type: str) -> str | None:
    """Which of our classes a SEG segment describes, from its label and coded type."""
    text = f"{label} {property_type}".lower()
    for word, name in _WORDS:
        if word in text:
            return name
    return None


def read_seg_labels(seg_path: Path, ct: CtSeries) -> tuple[np.ndarray, dict[str, list[str]]]:
    """Return a uint8 (slices, rows, cols) label volume in the CT's order.

    Also returns which SEG segments went into each class, for the case notes.
    Segments that match none of our classes are left out.
    """
    seg = hd.seg.segread(seg_path)
    referenced = {str(s.SeriesInstanceUID) for s in seg.ReferencedSeriesSequence}
    if ct.series_instance_uid not in referenced:
        raise ValueError("this SEG does not reference the CT series given")

    # Some tools (including the one that made C4KC-KiTS) leave out the flag that says
    # frames sit exactly on their source images, so highdicom will not trust it.
    # Check the positions ourselves instead of taking it on faith.
    _check_frames_sit_on_source_images(seg, ct)

    labels = np.zeros(ct.shape, dtype=np.uint8)
    winning_priority = np.zeros(ct.shape, dtype=np.uint8)
    used: dict[str, list[str]] = {}

    for number in seg.segment_numbers:
        description = seg.get_segment_description(number)
        name = class_for_segment(description.segment_label, description.segmented_property_type.meaning)
        if name is None:
            continue
        mask = seg.get_pixels_by_source_instance(
            source_sop_instance_uids=ct.sop_instance_uids,
            segment_numbers=[number],
            combine_segments=False,
            assert_missing_frames_are_empty=True,
            ignore_spatial_locations=True,
        )[..., 0] > 0
        if mask.shape != ct.shape:
            raise ValueError(f"segment {number} has shape {mask.shape}, CT has {ct.shape}")
        priority = _PRIORITY[name]
        take = mask & (winning_priority < priority)
        labels[take] = CLASS_VALUE[name]
        winning_priority[take] = priority
        used.setdefault(name, []).append(description.segment_label)

    return labels, used


def _check_frames_sit_on_source_images(seg: hd.seg.Segmentation, ct: CtSeries, tolerance_mm: float = 0.1) -> None:
    """Every SEG frame must lie where the CT slice it names lies, and be the same size."""
    if (int(seg.Rows), int(seg.Columns)) != ct.shape[1:]:
        raise ValueError("SEG frames are a different size from the CT slices")
    position_of = {uid: ct.positions[i] for i, uid in enumerate(ct.sop_instance_uids)}
    for frame in seg.PerFrameFunctionalGroupsSequence:
        source_uids = [
            str(source.ReferencedSOPInstanceUID)
            for derivation in frame.DerivationImageSequence
            for source in derivation.SourceImageSequence
        ]
        frame_position = np.array(frame.PlanePositionSequence[0].ImagePositionPatient, dtype=float)
        for uid in source_uids:
            if uid in position_of and np.linalg.norm(position_of[uid] - frame_position) > tolerance_mm:
                raise ValueError(f"a SEG frame is not where CT image {uid} is")
