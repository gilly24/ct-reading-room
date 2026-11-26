"""Downloading public cases from the NCI Imaging Data Commons (no account needed)."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path

import pydicom

log = logging.getLogger(__name__)

KITS = "c4kc_kits"
KITS_DATASET = {
    "dataset": "C4KC-KiTS",
    "collection": KITS,
    "citation": (
        "Heller N, Sathianathen N, Kalapara A, et al. Data from C4KC-KiTS [Data set]. "
        "The Cancer Imaging Archive, 2019. https://doi.org/10.7937/TCIA.2019.IX49E8NX"
    ),
    "url": "https://portal.imaging.datacommons.cancer.gov/collections/c4kc_kits",
}


@dataclass
class Fetched:
    patient_id: str
    study_dir: str
    ct_series_uid: str
    ct_description: str
    slices: int
    licence: str
    doi: str
    age: str | None
    sex: str | None


def fetch_kits(raw_dir: Path, count: int, max_slices: int, patients: list[str] | None = None) -> list[Fetched]:
    """Download `count` C4KC-KiTS studies whose outlined CT has at most `max_slices` slices.

    Each SEG names the CT series it was drawn on; only that series is downloaded.
    A manifest of what was fetched is kept in raw_dir/fetched.json.
    """
    from idc_index import IDCClient  # slow to import; only needed here

    client = IDCClient()
    raw_dir = Path(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = raw_dir / "fetched.json"
    done = {f["patient_id"]: Fetched(**f) for f in _read(manifest_path)}

    segs = client.sql_query(
        f"""SELECT PatientID, StudyInstanceUID, SeriesInstanceUID FROM index
            WHERE collection_id = '{KITS}' AND Modality = 'SEG' ORDER BY PatientID"""
    )
    if patients:
        segs = segs[segs.PatientID.isin(patients)]

    fetched: list[Fetched] = [f for f in done.values() if not patients or f.patient_id in patients]
    for row in segs.itertuples():
        if len(fetched) >= count:
            break
        if row.PatientID in done:
            continue
        study_dir = raw_dir / row.PatientID
        log.info("%s: reading its SEG", row.PatientID)
        client.download_from_selection(
            downloadDir=str(study_dir),
            seriesInstanceUID=[row.SeriesInstanceUID],
            dirTemplate="%Modality_%SeriesInstanceUID",
            show_progress_bar=False,
        )
        # Look only in the SEG's own folder: after an interrupted run the CT folder
        # may already hold files, and any of them could come first.
        seg_file = next((study_dir / f"SEG_{row.SeriesInstanceUID}").rglob("*.dcm"))
        seg = pydicom.dcmread(seg_file, stop_before_pixels=True)
        ct_uid = str(seg.ReferencedSeriesSequence[0].SeriesInstanceUID)

        ct = client.sql_query(
            f"""SELECT SeriesDescription, instanceCount, license_short_name, source_DOI, PatientAge, PatientSex
                FROM index WHERE SeriesInstanceUID = '{ct_uid}'"""
        )
        if ct.empty:
            log.warning("%s: its CT series is not in IDC, skipping", row.PatientID)
            continue
        info = ct.iloc[0]
        if int(info.instanceCount) > max_slices:
            log.info("%s: %d slices is over %d, skipping", row.PatientID, info.instanceCount, max_slices)
            seg_file.unlink()
            continue

        log.info("%s: downloading %d CT slices", row.PatientID, info.instanceCount)
        client.download_from_selection(
            downloadDir=str(study_dir),
            seriesInstanceUID=[ct_uid],
            dirTemplate="%Modality_%SeriesInstanceUID",
            show_progress_bar=False,
        )
        item = Fetched(
            patient_id=row.PatientID,
            study_dir=str(study_dir),
            ct_series_uid=ct_uid,
            ct_description=str(info.SeriesDescription or ""),
            slices=int(info.instanceCount),
            licence=str(info.license_short_name),
            doi=str(info.source_DOI),
            age=_clean(info.PatientAge),
            sex=_clean(info.PatientSex),
        )
        fetched.append(item)
        done[item.patient_id] = item
        manifest_path.write_text(json.dumps([asdict(f) for f in done.values()], indent=1))
    return fetched


def kits_source(item: Fetched) -> dict:
    return {**KITS_DATASET, "patient": item.patient_id, "licence": item.licence, "doi": item.doi}


def kits_patient(item: Fetched) -> dict:
    patient = {}
    if item.age and item.age[:-1].isdigit():
        patient["age"] = int(item.age[:-1])
    if item.sex in ("M", "F"):
        patient["sex"] = item.sex
    return patient


def _clean(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("nan", "none"):
        return None
    return text


def _read(path: Path) -> list[dict]:
    return json.loads(path.read_text()) if path.exists() else []
