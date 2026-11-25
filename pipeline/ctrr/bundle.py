"""Writing a case bundle: the files the web app loads. docs/case-format.md describes them."""

from __future__ import annotations

import gzip
import json
import re
import shutil
from pathlib import Path

import imagecodecs
import numpy as np
import pydicom
from pydicom.encaps import encapsulate
from pydicom.uid import HTJ2KLossless

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
        write_htj2k(src, folder / name)
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


def write_htj2k(src: Path, dest: Path) -> None:
    """Write one CT file again with its pixels as lossless HTJ2K, about a third of the size.

    Every other element is kept, the SOP Instance UID included: lossless compression
    does not make a new image. The codestream is decoded again and compared with the
    original before it is written, so a pixel value that would change stops the build.
    """
    ds = pydicom.dcmread(src)
    if int(getattr(ds, "NumberOfFrames", 1) or 1) != 1 or int(ds.SamplesPerPixel) != 1:
        raise ValueError(f"{src}: expected one greyscale frame")
    values = ds.pixel_array
    bits = int(ds.BitsStored)
    signed = int(ds.PixelRepresentation) == 1
    low, high = (-(1 << (bits - 1)), (1 << (bits - 1)) - 1) if signed else (0, (1 << bits) - 1)
    fits = values.min() >= low and values.max() <= high
    syntax = ds.file_meta.TransferSyntaxUID
    if fits and not syntax.is_compressed:
        # pydicom drops bits above Bits Stored as it reads; a viewer may not. Refuse
        # rather than encode a value that differs from the stored one.
        dtype = values.dtype.newbyteorder("<" if syntax.is_little_endian else ">")
        stored = np.frombuffer(ds.PixelData, dtype=dtype, count=values.size).reshape(values.shape)
        fits = np.array_equal(stored, values)
    if not fits:
        raise ValueError(f"{src}: pixel values do not fit in Bits Stored ({bits})")

    codestream = imagecodecs.htj2k_encode(values, level=0, reversible=True, bitspersample=bits)
    decoded = imagecodecs.htj2k_decode(codestream)
    if decoded.shape != values.shape or not np.array_equal(decoded, values):
        raise ValueError(f"{src}: HTJ2K round trip changed pixel values")

    ds.PixelData = encapsulate([codestream])
    ds["PixelData"].VR = "OB"
    ds["PixelData"].is_undefined_length = True
    ds.file_meta.TransferSyntaxUID = HTJ2KLossless
    ds.save_as(dest, enforce_file_format=True)


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
