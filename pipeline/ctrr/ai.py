"""The AI second reader's findings for a case.

A segmentation model (nnU-Net, trained on C4KC-KiTS) outlines the kidneys and
tumours. Its outlines are measured by findings.py, exactly as the reference
outlines are, so every number the site shows for the AI comes from a
measurement of what the model drew, never from the model itself.

A model is described by a model.json that training writes:

    {
      "schema": 1,
      "name": "nnU-Net kidney and tumour",
      "version": "fold 0, 2026-12-01",
      "architecture": "nnU-Net v2, 3D full resolution, residual encoder (ResEnc M)",
      "dataset": "C4KC-KiTS",
      "trainedOn": ["KiTS-00000", "KiTS-00001", ...],
      "labels": {"1": "kidney", "2": "tumour"},
      "card": "docs/model-card.md"
    }

`trainedOn` lists every patient the model saw while training, validation
included. A model is never shown reading one of them: that would be marking an
exam it had already seen.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import highdicom as hd
import numpy as np
from pydicom.sr.codedict import codes

from .bundle import SCHEMA_VERSION, write_index, write_json, write_label_volume
from .dicom_io import CtSeries, load_case_ct
from .findings import measure_lesions
from .seg_io import CLASS_VALUE, SEGMENT_CODES

# The labels the C4KC-KiTS training set uses (train_data.TRAIN_LABELS), as model.json writes them.
KITS_MODEL_LABELS = {"1": "kidney", "2": "tumour"}
KITS_MODEL_NAME = "nnU-Net kidney and tumour"

AI_JSON = "ai.json"
AI_LABELS = "ai-labels.u8.gz"
AI_SEG = "ai-seg.dcm"


@dataclass(frozen=True)
class Model:
    name: str
    version: str
    architecture: str
    dataset: str
    trained_on: frozenset[str]
    labels: dict[int, str]  # the model's output value -> our class name
    card: str | None

    @classmethod
    def load(cls, path: Path) -> Model:
        data = json.loads(Path(path).read_text())
        if data.get("schema") != 1:
            raise ValueError(f"{path}: schema must be 1")
        missing = [k for k in ("name", "version", "architecture", "dataset", "trainedOn", "labels") if k not in data]
        if missing:
            raise ValueError(f"{path}: missing {', '.join(missing)}")
        labels = {int(value): name for value, name in data["labels"].items()}
        unknown = sorted(set(labels.values()) - set(CLASS_VALUE))
        if unknown or 0 in labels:
            raise ValueError(f"{path}: labels must map values above 0 to {sorted(CLASS_VALUE)}, got {data['labels']}")
        if not data["trainedOn"]:
            raise ValueError(f"{path}: trainedOn is empty; list every patient the model saw")
        return cls(
            name=str(data["name"]),
            version=str(data["version"]),
            architecture=str(data["architecture"]),
            dataset=str(data["dataset"]),
            trained_on=frozenset(str(p) for p in data["trainedOn"]),
            labels=labels,
            card=data.get("card"),
        )


def describe_model(split: dict, run: Path | None = None, fold: int = 0, card: str = "docs/model-card.md") -> dict:
    """model.json for a model trained on a split's training patients.

    `trainedOn` is every training patient, the fold's validation patients
    included: the model was chosen on them, so they are not unseen either.
    Refuses a split in which any test or site patient is also a training
    patient. With `run` (nnU-Net's results folder for the model), checks that
    the fold was trained, that the labels are the training set's, and records
    the trainer and plans.
    """
    trained = sorted(split["train"])
    held_out = set(split["test"]) | set(split.get("site_cases", []))
    leaked = sorted(held_out & set(trained))
    if leaked:
        raise ValueError(f"the split trains on held-out patients: {', '.join(leaked)}")
    architecture = "nnU-Net v2, 3D full resolution"
    version = f"fold {fold}"
    if run is not None:
        run = Path(run)
        parts = run.name.split("__")
        if len(parts) != 3:
            raise ValueError(f"{run.name}: expected nnU-Net's <trainer>__<plans>__<configuration> folder")
        trainer, plans, configuration = parts
        checkpoint = run / f"fold_{fold}" / "checkpoint_final.pth"
        if not checkpoint.exists():
            raise ValueError(f"{checkpoint} does not exist: fold {fold} has not finished training")
        labels = json.loads((run / "dataset.json").read_text())["labels"]
        expected = {"background": 0, **{name: int(value) for value, name in KITS_MODEL_LABELS.items()}}
        if labels != expected:
            raise ValueError(f"{run}/dataset.json labels {labels} are not the training set's {expected}")
        architecture = f"nnU-Net v2, {configuration}, {plans}, {trainer}"
        version = f"{plans}, fold {fold}"
    return {
        "schema": 1,
        "name": KITS_MODEL_NAME,
        "version": version,
        "architecture": architecture,
        "dataset": split["dataset"],
        "trainedOn": trained,
        "labels": KITS_MODEL_LABELS,
        "card": card,
    }


def check_held_out(model: Model, case: dict) -> None:
    """Refuse a case whose patient the model trained on."""
    patient = case.get("source", {}).get("patient")
    if patient and patient in model.trained_on:
        raise ValueError(
            f"{case['id']}: the model trained on {patient}, so its read of this case would not be a fair test"
        )


def to_case_labels(prediction: np.ndarray, model: Model) -> np.ndarray:
    """The model's label values as ours (seg_io.CLASSES)."""
    found = {int(v) for v in np.unique(prediction)} - {0}
    unknown = sorted(found - set(model.labels))
    if unknown:
        raise ValueError(f"the prediction has values {unknown} that the model's labels do not name")
    labels = np.zeros(prediction.shape, dtype=np.uint8)
    for value, name in model.labels.items():
        labels[prediction == value] = CLASS_VALUE[name]
    return labels


def write_ai(case_folder: Path, prediction: np.ndarray, model: Model) -> Path:
    """Measure a model's outlines of a case and add them to the case folder.

    `prediction` is head first, on the case's CT grid, in the model's own label
    values (nifti.read_labels gives this from nnU-Net's output). Writes ai.json,
    ai-labels.u8.gz and ai-seg.dcm, points case.json at ai.json and rewrites
    the index next to the case. Returns the path of ai.json.
    """
    folder = Path(case_folder)
    case = json.loads((folder / "case.json").read_text())
    check_held_out(model, case)
    ct = load_case_ct(folder)
    geometry = case["geometry"]
    if ct.shape != (geometry["slices"], geometry["rows"], geometry["columns"]):
        raise ValueError(f"{folder}: the CT files do not match case.json")
    if prediction.shape != ct.shape:
        raise ValueError(f"prediction {prediction.shape} does not match the CT {ct.shape}")

    labels = to_case_labels(prediction, model)
    lesions = measure_lesions(labels, ct)
    wrote_seg = _write_seg(folder / AI_SEG, ct, labels, model)

    held_out = "this case's patient was not among them" if case.get("source", {}).get("patient") else "this case was not among them"
    patients = len(model.trained_on)
    ai = {
        "schema": SCHEMA_VERSION,
        "caseId": case["id"],
        "model": {
            "name": model.name,
            "version": model.version,
            "architecture": model.architecture,
            "trainedOn": {"dataset": model.dataset, "patients": len(model.trained_on)},
            "card": model.card,
        },
        "heldOut": True,
        "note": (
            f"Outlines by {model.name}, trained on {patients} {model.dataset} patient{'' if patients == 1 else 's'}; "
            f"{held_out}. Measured by the same code as the reference."
        ),
        "labels": write_label_volume(folder, AI_LABELS, labels),
        "files": {"seg": AI_SEG} if wrote_seg else {},
        "lesions": [lesion.to_json() for lesion in lesions],
    }
    write_json(folder / AI_JSON, ai)
    case["ai"] = AI_JSON
    write_json(folder / "case.json", case)
    write_index(folder.parent)
    return folder / AI_JSON


def _write_seg(path: Path, ct: CtSeries, labels: np.ndarray, model: Model) -> bool:
    """The outlines as DICOM SEG, so they open in any PACS beside the CT. False if there were none."""
    present = [name for name in SEGMENT_CODES if (labels == CLASS_VALUE[name]).any()]
    algorithm = hd.AlgorithmIdentificationSequence(
        name=model.name[:64],
        version=model.version[:64],
        family=codes.cid7162.ArtificialIntelligence,
    )
    descriptions = [
        hd.seg.SegmentDescription(
            segment_number=number,
            segment_label=name.capitalize(),
            segmented_property_category=SEGMENT_CODES[name][0],
            segmented_property_type=SEGMENT_CODES[name][1],
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.AUTOMATIC,
            algorithm_identification=algorithm,
        )
        for number, name in enumerate(present, start=1)
    ]
    if not descriptions:
        # Nothing outlined: there is nothing for a SEG to hold.
        path.unlink(missing_ok=True)
        return False
    masks = np.stack([labels == CLASS_VALUE[name] for name in present], axis=-1).astype(np.uint8)
    seg = hd.seg.Segmentation(
        source_images=ct.datasets,
        pixel_array=masks,
        segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
        segment_descriptions=descriptions,
        series_instance_uid=hd.UID(),
        series_number=900,
        sop_instance_uid=hd.UID(),
        instance_number=1,
        manufacturer="CT Reading Room",
        manufacturer_model_name=model.name[:64],
        software_versions=model.version[:64],
        device_serial_number="0",
        series_description="AI second reader (not for clinical use)",
    )
    seg.save_as(path)
    return True
