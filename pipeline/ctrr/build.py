"""One CT series plus its DICOM SEG in, one case bundle out."""

from __future__ import annotations

from pathlib import Path

import pydicom

from .bundle import write_case
from .dicom_io import CT_IMAGE_STORAGE, find_dicom_files, load_ct_series
from .findings import measure_lesions
from .seg_io import read_seg_labels

SEG_STORAGE = "1.2.840.10008.5.1.4.1.1.66.4"


def split_series(files: list[Path]) -> tuple[dict[str, list[Path]], list[Path]]:
    """Group CT files by series, and pick out SEG files."""
    ct: dict[str, list[Path]] = {}
    segs: list[Path] = []
    for path in files:
        ds = pydicom.dcmread(path, stop_before_pixels=True)
        sop_class = str(ds.SOPClassUID)
        if sop_class == SEG_STORAGE:
            segs.append(path)
        elif sop_class == CT_IMAGE_STORAGE:
            ct.setdefault(str(ds.SeriesInstanceUID), []).append(path)
    return ct, segs


def build_case(
    study_dir: Path,
    out_root: Path,
    case_id: str,
    title: str,
    source: dict,
    truth_note: str,
    patient: dict | None = None,
    description: str | None = None,
) -> Path:
    """Build a case from a folder holding one SEG and the CT series it outlines."""
    files = find_dicom_files(study_dir)
    ct_series, segs = split_series(files)
    if len(segs) != 1:
        raise ValueError(f"{study_dir}: expected one SEG, found {len(segs)}")
    seg_ds = pydicom.dcmread(segs[0], stop_before_pixels=True)
    referenced = [str(s.SeriesInstanceUID) for s in seg_ds.ReferencedSeriesSequence]
    matching = [uid for uid in referenced if uid in ct_series]
    if not matching:
        raise ValueError(f"{study_dir}: the CT series the SEG outlines is not in this folder")

    ct = load_ct_series(ct_series[matching[0]])
    labels, _ = read_seg_labels(segs[0], ct)
    lesions = measure_lesions(labels, ct)
    return write_case(
        out_root=out_root,
        case_id=case_id,
        title=title,
        ct=ct,
        labels=labels,
        lesions=lesions,
        source=source,
        truth_note=truth_note,
        patient=patient,
        description=description,
    )
