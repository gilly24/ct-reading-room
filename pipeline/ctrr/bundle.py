"""Writing a case bundle: the files the web app loads. docs/case-format.md describes them."""

from __future__ import annotations

import gzip
import json
import re
import shutil
from pathlib import Path

import numpy as np

from .dicom_io import CtSeries
from .findings import Lesion
from .seg_io import CLASSES

SCHEMA_VERSION = 1
CASE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")


def write_case(
    out_root: Path,
    case_id: str,
    title: str,
    ct: CtSeries,
    labels: np.ndarray,
    lesions: list[Lesion],
    source: dict,
    truth_note: str,
    patient: dict | None = None,
    description: str | None = None,
) -> Path:
    """Write cases/<case_id>/ and return its folder. Replaces an existing case of that id."""
    if not CASE_ID.match(case_id):
        raise ValueError(f"case id {case_id!r} must be lowercase letters, digits and dashes")
    if labels.shape != ct.shape:
        raise ValueError("labels and CT differ in shape")

    folder = Path(out_root) / case_id
    if folder.exists():
        shutil.rmtree(folder)
    (folder / "ct").mkdir(parents=True)

    images = []
    for i, src in enumerate(ct.paths):
        name = f"ct/{i:04d}.dcm"
        shutil.copyfile(src, folder / name)
        images.append(name)

    first = ct.datasets[0]
    window_center, window_width = 40, 400  # soft tissue; every abdominal read starts here

    case = {
        "schema": SCHEMA_VERSION,
        "id": case_id,
        "title": title,
        "modality": "CT",
        "description": description or str(getattr(first, "SeriesDescription", "") or "CT"),
        "patient": patient or {},
        "geometry": {
            "rows": ct.shape[1],
            "columns": ct.shape[2],
            "slices": ct.shape[0],
            "pixelSpacingMm": [round(v, 4) for v in ct.pixel_spacing],
            "sliceSpacingMm": round(ct.slice_spacing, 4),
            "sliceThicknessMm": ct.slice_thickness,
            "order": "head-first",
        },
        "window": {"center": window_center, "width": window_width},
        "images": images,
        "source": source,
        "truth": "truth.json",
        "ai": None,
    }

    labels_name = "labels.u8.gz"
    # No timestamp or file name in the gzip header, so the same labels make the same bytes.
    with open(folder / labels_name, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as f:
        f.write(np.ascontiguousarray(labels, dtype=np.uint8).tobytes(order="C"))

    present = sorted(int(v) for v in np.unique(labels) if v != 0)
    truth = {
        "schema": SCHEMA_VERSION,
        "caseId": case_id,
        "note": truth_note,
        "labels": {
            "file": labels_name,
            "encoding": "uint8, gzip, C order (slice, row, column), same slice order as images",
            "shape": list(labels.shape),
            "classes": {str(v): CLASSES[v] for v in present},
        },
        "lesions": [lesion.to_json() for lesion in lesions],
    }

    _write_json(folder / "case.json", case)
    _write_json(folder / "truth.json", truth)
    return folder


def write_index(cases_root: Path) -> Path:
    """cases/index.json: every case, without anything that gives the answers away."""
    entries = []
    for case_file in sorted(Path(cases_root).glob("*/case.json")):
        case = json.loads(case_file.read_text())
        entries.append(
            {
                "id": case["id"],
                "title": case["title"],
                "description": case["description"],
                "slices": case["geometry"]["slices"],
                "dataset": case["source"].get("dataset"),
                "hasAi": bool(case.get("ai")),
            }
        )
    # The phantom is the tutorial, so it goes first.
    entries.sort(key=lambda e: (not e["id"].startswith("phantom"), e["id"]))
    path = Path(cases_root) / "index.json"
    _write_json(path, {"schema": SCHEMA_VERSION, "cases": entries})
    return path


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
