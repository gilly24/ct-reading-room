"""C4KC-KiTS studies in, an nnU-Net v2 raw dataset out, with a report of every check.

    uv sync --extra train
    uv run ctrr fetch-kits --raw .data/train-raw --count 210 --max-slices 100000
    uv run ctrr train-data --raw .data/train-raw --out .data/nnUNet_raw

writes <out>/Dataset501_C4KCKiTS/

    imagesTr/KiTS-00000_0000.nii.gz   CT in Hounsfield units, training patients only
    labelsTr/KiTS-00000.nii.gz        0 background, 1 kidney, 2 tumour
    imagesTs/, labelsTs/              the held-out test patients, same format. nnU-Net
                                      never reads these folders, so it cannot plan,
                                      normalise or train on them
    dataset.json
    splits_final.json                 five folds over the training patients; nnU-Net
                                      reads it from nnUNet_preprocessed/Dataset501_C4KCKiTS/
    validation.json, validation.md    every check on every case, and why any failed

Which patients train and which are held out is fixed in kits_split.json, made once
by make_split(). A case that fails a check is left out; it never moves to the other
side of the split.

The files keep this project's order: array slice 0 is the most superior slice, and
each file's direction matrix says so. SimpleITK writes them, and like DICOM it works
in LPS, so no axis is flipped on the way.
"""

from __future__ import annotations

import hashlib
import json
import logging
import statistics
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import pydicom

from .build import split_series
from .dicom_io import CtSeries, find_dicom_files, load_ct_series
from .idc import KITS_DATASET, Fetched, _read
from .seg_io import CLASS_VALUE, CLASSES, class_for_segment, read_seg_labels

log = logging.getLogger(__name__)

DATASET_ID = 501
DATASET = f"Dataset{DATASET_ID:03d}_C4KCKiTS"
SPLIT_FILE = Path(__file__).with_name("kits_split.json")

# The KiTS cases the website shows. The AI will be shown and scored on them, so it
# must never train on them: make_split() always holds them out, and
# tests/test_train_data.py checks it. A KiTS case added to the site later must come
# from the test set too.
SITE_CASES = ("KiTS-00002", "KiTS-00003", "KiTS-00004", "KiTS-00006", "KiTS-00007")

SPLIT_SEED = "ct-reading-room kits split 1"
TEST_SIZE = 40
FOLDS = 5

# nnU-Net wants background 0 and the other labels consecutive. They are tied to
# seg_io.CLASSES by name, so a change of value there cannot relabel the training set.
TRAIN_LABELS = {"background": 0, "kidney": 1, "tumour": 2}

# Slices may be a little unevenly spaced (dicom_io allows 10%); nnU-Net assumes one
# spacing per case, so training asks for more.
MAX_GAP_SPREAD = 0.01

CHECKS = (
    "Folder: one SEG and one CT series; the SEG outlines that series; every slice IDC lists is on disk.",
    "Headers: the CT and the SEG name the patient the folder is for, and share a study and a frame of reference.",
    "CT (dicom_io.load_ct_series): single-frame axial CT; one orientation, size and pixel spacing for every "
    "slice; no two slices at one position; evenly spaced; sorted head first.",
    "Stack: slice 0 is the most superior; slices step straight along the slice normal (no sideways drift, "
    "i.e. no gantry tilt); gaps agree within 1%.",
    "SEG geometry: same rows, columns, orientation and pixel spacing as the CT; every frame names a CT image "
    "of this series and lies where that image lies (seg_io).",
    "Segments and labels: segments are kidney and tumour ('Mass') only; label values are only 0, 1 and 2.",
    "Content: a kidney is outlined; Hounsfield units are whole numbers that fit int16, so nothing is rounded.",
    "Written files: image and label read back with the same size, spacing, origin and direction, and voxel "
    "(0, 0, k) of the file lies where CT slice k lies.",
    "Across cases: no patient, study, CT series or SEG appears twice, no two cases have byte-identical CT "
    "pixels, and every case is in kits_split.json.",
)


# --- the split -------------------------------------------------------------------


def _rank(patient: str, seed: str) -> str:
    return hashlib.sha256(f"{seed}:{patient}".encode()).hexdigest()


def make_split(
    patients: list[str],
    site_cases: tuple[str, ...] = SITE_CASES,
    test_size: int = TEST_SIZE,
    folds: int = FOLDS,
    seed: str = SPLIT_SEED,
) -> dict:
    """A fixed train/test split and cross-validation folds, the same on any machine.

    The test set is the site cases plus the other patients that come first when
    ordered by sha256(seed:PatientID). The rest train; in the same order they are
    dealt into `folds` validation folds. No random generator, so no version of
    Python or NumPy can change the answer.
    """
    patients = sorted(set(patients))
    missing = sorted(set(site_cases) - set(patients))
    if missing:
        raise ValueError(f"site cases not among the patients: {missing}")
    ranked = sorted((p for p in patients if p not in site_cases), key=lambda p: _rank(p, seed))
    take = test_size - len(site_cases)
    test = sorted([*site_cases, *ranked[:take]])
    train_ranked = ranked[take:]
    return {
        "about": (
            "Fixed train/test split of the C4KC-KiTS patients for the AI second reader. Test patients are "
            "never trained on, planned on or used to pick a model. Made by ctrr.train_data.make_split; "
            "tests/test_train_data.py checks it. 'folds' are the validation patients of each "
            "cross-validation fold; a fold trains on the other training patients."
        ),
        "dataset": KITS_DATASET["dataset"],
        "seed": seed,
        "method": (
            "test = site_cases + the other patients with the smallest sha256(seed + ':' + PatientID); "
            f"train = the rest; folds = train in that same order, dealt round-robin into {folds}"
        ),
        "site_cases": list(site_cases),
        "test": test,
        "train": sorted(train_ranked),
        "folds": [sorted(train_ranked[i::folds]) for i in range(folds)],
    }


def load_split(path: Path = SPLIT_FILE) -> dict:
    return json.loads(Path(path).read_text())


def nnunet_splits(split: dict, keep: set[str] | None = None) -> list[dict]:
    """splits_final.json for nnU-Net: the folds over training patients, less any not in `keep`."""
    train = [p for p in split["train"] if keep is None or p in keep]
    folds = []
    for val in split["folds"]:
        val = [p for p in val if p in train]
        folds.append({"train": [p for p in train if p not in val], "val": val})
    return folds


# --- labels and geometry -----------------------------------------------------------


def training_labels(classes: np.ndarray) -> tuple[np.ndarray, list[str]]:
    """seg_io class values to nnU-Net's, and the names of any class that has no place here."""
    table = np.zeros(256, dtype=np.uint8)
    allowed = {0}
    for name, value in TRAIN_LABELS.items():
        if name != "background":
            table[CLASS_VALUE[name]] = value
            allowed.add(CLASS_VALUE[name])
    counts = np.bincount(classes.ravel(), minlength=256)
    unexpected = [CLASSES.get(int(v), f"value {v}") for v in np.flatnonzero(counts) if v not in allowed]
    return table[classes], unexpected


@dataclass
class Geometry:
    """What SimpleITK needs to place an array in CtSeries order (slices, rows, columns).

    ITK's first index runs along a row (the DICOM row direction), the second down the
    columns, the third through the slices from the most superior one down.
    """

    spacing: tuple[float, float, float]
    origin: tuple[float, float, float]
    direction: tuple[float, ...]  # 3x3, row-major; its columns are the three axes

    def index_to_world(self, i: float, j: float, k: float) -> np.ndarray:
        axes = np.array(self.direction).reshape(3, 3)
        return np.array(self.origin) + axes @ (np.array(self.spacing) * [i, j, k])


def ct_geometry(ct: CtSeries) -> Geometry:
    row, col = ct.row_direction, ct.column_direction
    normal = np.cross(row, col)
    normal /= np.linalg.norm(normal)
    along = ct.positions @ normal
    step = normal if len(along) < 2 or along[-1] > along[0] else -normal
    gaps = np.abs(np.diff(along))
    spacing = float(np.median(gaps)) if len(gaps) else ct.slice_spacing
    axes = np.column_stack([row, col, step])
    return Geometry(
        spacing=(ct.pixel_spacing[1], ct.pixel_spacing[0], spacing),
        origin=tuple(float(v) for v in ct.positions[0]),
        direction=tuple(float(v) for v in axes.flatten()),
    )


def write_nifti(array: np.ndarray, geometry: Geometry, path: Path) -> None:
    import SimpleITK as sitk  # the `train` extra

    image = sitk.GetImageFromArray(array)
    image.SetSpacing(geometry.spacing)
    image.SetOrigin(geometry.origin)
    image.SetDirection(geometry.direction)
    sitk.WriteImage(image, str(path), useCompression=True)


def read_geometry(path: Path) -> tuple[tuple[int, ...], Geometry]:
    import SimpleITK as sitk

    reader = sitk.ImageFileReader()
    reader.SetFileName(str(path))
    reader.ReadImageInformation()
    return reader.GetSize(), Geometry(reader.GetSpacing(), reader.GetOrigin(), reader.GetDirection())


# --- one case --------------------------------------------------------------------------


class CaseProblem(Exception):
    """A reason to leave the case out."""


@dataclass
class CaseResult:
    patient_id: str
    split: str | None  # "train", "test", or None when kits_split.json does not have it
    problems: list[str] = field(default_factory=list)  # any problem leaves the case out
    warnings: list[str] = field(default_factory=list)
    facts: dict = field(default_factory=dict)


def case_paths(out: Path, patient_id: str, split: str) -> tuple[Path, Path]:
    suffix = "Tr" if split == "train" else "Ts"
    return out / f"images{suffix}" / f"{patient_id}_0000.nii.gz", out / f"labels{suffix}" / f"{patient_id}.nii.gz"


def convert_case(patient_id: str, study_dir: str, expected_slices: int, split: str | None, out: str | None) -> dict:
    """Check one fetched study and, if it passes and has a side in the split, write it.

    Returns the CaseResult as a dict. Runs in a worker process.
    """
    result = CaseResult(patient_id, split)
    paths = case_paths(Path(out), patient_id, split) if out and split else None
    try:
        _convert(result, Path(study_dir), expected_slices, paths)
    except CaseProblem as problem:
        result.problems.append(str(problem))
    except Exception as error:  # keep the run going; the report says what happened
        result.problems.append(f"unexpected error: {type(error).__name__}: {error}")
    if split is None:
        result.problems.append("not in kits_split.json")
    if result.problems and paths:
        for path in paths:
            path.unlink(missing_ok=True)
    return asdict(result)


def _convert(result: CaseResult, study_dir: Path, expected_slices: int, paths: tuple[Path, Path] | None) -> None:
    facts = result.facts

    ct_files, segs = split_series(find_dicom_files(study_dir))
    if len(segs) != 1:
        raise CaseProblem(f"{len(segs)} SEG files in the folder, expected one")
    if len(ct_files) != 1:
        raise CaseProblem(f"{len(ct_files)} CT series in the folder, expected one")
    ((ct_uid, ct_paths),) = ct_files.items()
    seg = pydicom.dcmread(segs[0], stop_before_pixels=True)
    facts.update(
        ct_series_uid=ct_uid,
        seg_series_uid=str(seg.SeriesInstanceUID),
        study_uid=str(seg.StudyInstanceUID),
    )
    if ct_uid not in {str(s.SeriesInstanceUID) for s in seg.ReferencedSeriesSequence}:
        raise CaseProblem("the SEG does not outline the CT series in the folder")
    if len(ct_paths) != expected_slices:
        raise CaseProblem(f"{len(ct_paths)} CT slices on disk, IDC lists {expected_slices}: incomplete download?")

    try:
        ct = load_ct_series(ct_paths)
    except ValueError as error:
        raise CaseProblem(f"CT: {error}") from None

    _check_headers(result, ct, seg)
    geometry = _check_stack(result, ct)
    _check_seg_geometry(result, ct, seg)
    _check_segments(result, seg)
    if result.problems:
        return

    try:
        classes, _ = read_seg_labels(segs[0], ct)
    except ValueError as error:
        raise CaseProblem(f"SEG: {error}") from None
    labels, unexpected = training_labels(classes)
    del classes
    if unexpected:
        result.problems.append(f"label classes with no place in training: {', '.join(unexpected)}")

    hu = ct.hu
    if hu.min() < np.iinfo(np.int16).min or hu.max() > np.iinfo(np.int16).max:
        raise CaseProblem(f"HU range {hu.min():.0f}..{hu.max():.0f} does not fit int16")
    image = hu.astype(np.int16)
    if not np.array_equal(image, hu):
        raise CaseProblem("HU are not whole numbers; int16 would round them")
    ct.hu = image  # drop the float copy
    del hu

    counts = np.bincount(labels.ravel(), minlength=3)
    ml = ct.voxel_volume_mm3 / 1000
    labelled = np.flatnonzero(labels.any(axis=(1, 2)))
    facts.update(
        hu_min=int(image.min()),
        hu_max=int(image.max()),
        kidney_ml=round(float(counts[1] * ml), 1),
        tumour_ml=round(float(counts[2] * ml), 1),
        has_tumour=bool(counts[2]),
        kidney_mean_hu=round(float(image[labels == 1].mean()), 1) if counts[1] else None,
        tumour_mean_hu=round(float(image[labels == 2].mean()), 1) if counts[2] else None,
        labelled_slices=[int(labelled[0]), int(labelled[-1])] if len(labelled) else None,
        pixel_sha1=hashlib.sha1(np.ascontiguousarray(image).data).hexdigest(),
    )
    # Worth knowing, not worth leaving a case out for: nnU-Net's CT normalisation
    # clips every image to the 0.5-99.5 percentiles of outlined voxels anyway.
    below, above = int((image < -1024).sum()), int((image > 3071).sum())
    if below:
        result.warnings.append(f"HU below -1024: {below:,} voxels, down to {image.min()} (outside the scanned circle?)")
    if above:
        result.warnings.append(f"HU above 3071: {above:,} voxels, up to {image.max()} (metal?)")
    if not counts[1]:
        result.problems.append("no kidney outlined")
    if not counts[2]:
        result.warnings.append("no tumour: the SEG outlines none")
    if counts[1] and facts["kidney_mean_hu"] < 0:
        result.problems.append(
            f"the kidney outline averages {facts['kidney_mean_hu']} HU, fat or air: is it on the wrong voxels?"
        )
    if result.problems or paths is None:
        return

    image_path, label_path = paths
    write_nifti(image, geometry, image_path)
    write_nifti(labels, geometry, label_path)
    _check_written(result, ct, geometry, image_path, label_path)


def _close(a, b, tol: float = 1e-3) -> bool:
    return np.allclose(np.asarray(a, dtype=float), np.asarray(b, dtype=float), atol=tol)


def _check_headers(result: CaseResult, ct: CtSeries, seg) -> None:
    first = ct.datasets[0]
    for what, ds in (("CT", first), ("SEG", seg)):
        if str(ds.PatientID) != result.patient_id:
            result.problems.append(f"{what} header says PatientID {ds.PatientID}")
    if str(seg.StudyInstanceUID) != str(first.StudyInstanceUID):
        result.problems.append("the SEG and the CT are in different studies")
    if str(seg.FrameOfReferenceUID) != str(first.FrameOfReferenceUID):
        result.problems.append("the SEG and the CT have different frames of reference")


def _check_stack(result: CaseResult, ct: CtSeries) -> Geometry:
    """Slice order and orientation, beyond what load_ct_series already refuses."""
    row, col = ct.row_direction, ct.column_direction
    if abs(np.dot(row, col)) > 1e-3 or not _close([np.linalg.norm(row), np.linalg.norm(col)], [1, 1]):
        result.problems.append("row and column directions are not perpendicular unit vectors")
    if not ct.positions[0, 2] > ct.positions[-1, 2]:
        result.problems.append("slice 0 is not the most superior slice")

    geometry = ct_geometry(ct)
    step = np.array(geometry.direction).reshape(3, 3)[:, 2]
    offsets = ct.positions - ct.positions[0]
    along = offsets @ step
    drift = float(np.linalg.norm(offsets - np.outer(along, step), axis=1).max())
    if drift > 0.5 * min(ct.pixel_spacing):
        result.problems.append(f"slices drift {drift:.1f} mm sideways through the stack (gantry tilt?)")
    gaps = np.diff(along)
    spread = float(gaps.max() - gaps.min()) if len(gaps) else 0.0
    if (gaps <= 0).any():
        result.problems.append("slices do not step one way through the stack")
    elif spread > MAX_GAP_SPREAD * geometry.spacing[2] + 0.01:
        result.problems.append(f"slice gaps vary by {spread:.2f} mm around {geometry.spacing[2]:.2f} mm")

    numbers = [getattr(ds, "InstanceNumber", None) for ds in ct.datasets]
    if None not in numbers:
        steps = np.diff([int(n) for n in numbers])
        if not ((steps > 0).all() or (steps < 0).all()):
            result.warnings.append("InstanceNumber out of order: it does not follow slice position")
    if not _close([*row, *col], [1, 0, 0, 0, 1, 0], 1e-3):
        # Fine for nnU-Net, which trains on the array; the direction matrix keeps the rest right.
        angle = np.degrees(np.arctan2(row[1], row[0]))
        result.warnings.append(f"not the usual orientation: rows run {angle:.1f} degrees from patient left")

    result.facts.update(
        slices=ct.shape[0],
        rows=ct.shape[1],
        columns=ct.shape[2],
        pixel_spacing_mm=[round(v, 4) for v in ct.pixel_spacing],
        slice_spacing_mm=round(geometry.spacing[2], 4),
        slice_thickness_mm=ct.slice_thickness,
        orientation=[round(float(v), 3) for v in (*row, *col)],
        gap_spread_mm=round(spread, 4),
        drift_mm=round(drift, 4),
    )
    return geometry


def _per_frame(seg, sequence: str, attribute: str) -> list:
    """An attribute of a functional group, from the shared groups or else every frame."""
    shared = seg.SharedFunctionalGroupsSequence[0] if "SharedFunctionalGroupsSequence" in seg else None
    if shared is not None and sequence in shared:
        return [getattr(getattr(shared, sequence)[0], attribute)]
    return [getattr(getattr(frame, sequence)[0], attribute) for frame in seg.PerFrameFunctionalGroupsSequence]


def _check_seg_geometry(result: CaseResult, ct: CtSeries, seg) -> None:
    if (int(seg.Rows), int(seg.Columns)) != ct.shape[1:]:
        result.problems.append("SEG frames are a different size from the CT slices")
    ct_orientation = [*ct.row_direction, *ct.column_direction]
    if not all(_close(o, ct_orientation) for o in _per_frame(seg, "PlaneOrientationSequence", "ImageOrientationPatient")):
        result.problems.append("the SEG's orientation differs from the CT's")
    if not all(_close(s, ct.pixel_spacing) for s in _per_frame(seg, "PixelMeasuresSequence", "PixelSpacing")):
        result.problems.append("the SEG's pixel spacing differs from the CT's")
    sources = [
        {
            str(source.ReferencedSOPInstanceUID)
            for derivation in getattr(frame, "DerivationImageSequence", [])
            for source in getattr(derivation, "SourceImageSequence", [])
        }
        for frame in seg.PerFrameFunctionalGroupsSequence
    ]
    if not all(sources):
        result.problems.append("some SEG frames do not name the CT image they were drawn on")
    stray = set().union(*sources) - set(ct.sop_instance_uids)
    if stray:
        result.problems.append(f"{len(stray)} SEG frames name CT images that are not in this series")
    result.facts["seg_frames"] = int(seg.NumberOfFrames)


def _check_segments(result: CaseResult, seg) -> None:
    names = []
    for segment in seg.SegmentSequence:
        label = str(segment.SegmentLabel)
        meaning = str(segment.SegmentedPropertyTypeCodeSequence[0].CodeMeaning)
        name = class_for_segment(label, meaning)
        names.append(name)
        if name not in TRAIN_LABELS or name == "background":
            result.problems.append(f"segment '{label}' ({meaning}) is neither kidney nor tumour")
    if "kidney" not in names:
        result.problems.append("the SEG has no kidney segment")
    result.facts["segments"] = names


def _check_written(result: CaseResult, ct: CtSeries, geometry: Geometry, image_path: Path, label_path: Path) -> None:
    image_size, image_geometry = read_geometry(image_path)
    label_size, label_geometry = read_geometry(label_path)
    expected = (ct.shape[2], ct.shape[1], ct.shape[0])
    if image_size != expected or label_size != expected:
        result.problems.append(f"written sizes {image_size} and {label_size}, expected {expected}")
    for what in ("spacing", "origin", "direction"):
        written = [getattr(g, what) for g in (image_geometry, label_geometry)]
        if not all(_close(w, getattr(geometry, what), 1e-4) for w in written):
            result.problems.append(f"the written image and label disagree on {what}")
    worst = max(
        float(np.linalg.norm(image_geometry.index_to_world(0, 0, k) - ct.positions[k]))
        for k in range(ct.shape[0])
    )
    if worst > 0.01:
        result.problems.append(f"slices in the written file are up to {worst:.2f} mm from their CT slice")


# --- the whole set -----------------------------------------------------------------------


def build_training_set(
    raw_dir: Path,
    out_root: Path,
    jobs: int = 4,
    split_path: Path = SPLIT_FILE,
    patients: list[str] | None = None,
) -> dict:
    """Convert every fetched study, write dataset.json, splits_final.json and the report."""
    raw_dir, out = Path(raw_dir), Path(out_root) / DATASET
    manifest = [Fetched(**item) for item in _read(raw_dir / "fetched.json")]
    if patients:
        manifest = [m for m in manifest if m.patient_id in patients]
    if not manifest:
        raise SystemExit(f"nothing fetched in {raw_dir}: run ctrr fetch-kits --raw {raw_dir} first")
    split = load_split(split_path)
    side = {p: "train" for p in split["train"]} | {p: "test" for p in split["test"]}

    for name in ("imagesTr", "labelsTr", "imagesTs", "labelsTs"):
        (out / name).mkdir(parents=True, exist_ok=True)
        for stale in (out / name).glob("*.nii.gz"):
            stale.unlink()

    results: list[dict] = []
    with ProcessPoolExecutor(max_workers=jobs, max_tasks_per_child=1) as pool:
        futures = {
            pool.submit(convert_case, m.patient_id, m.study_dir, m.slices, side.get(m.patient_id), str(out)): m
            for m in manifest
        }
        for done, future in enumerate(as_completed(futures), 1):
            item = futures[future]
            try:
                result = future.result()
            except Exception as error:  # e.g. the worker ran out of memory
                result = asdict(CaseResult(item.patient_id, side.get(item.patient_id), [f"worker failed: {error!r}"]))
            results.append(result)
            status = "ok" if not result["problems"] else "LEFT OUT: " + "; ".join(result["problems"])
            log.info("[%d/%d] %s %s", done, len(manifest), item.patient_id, status)

    _check_across_cases(results, manifest)
    results.sort(key=lambda r: r["patient_id"])
    for result in results:
        if result["problems"] and result["split"]:
            for path in case_paths(out, result["patient_id"], result["split"]):
                path.unlink(missing_ok=True)

    passed = {r["patient_id"] for r in results if not r["problems"]}
    train = [p for p in split["train"] if p in passed]
    folds = nnunet_splits(split, keep=passed)
    (out / "dataset.json").write_text(json.dumps(_dataset_json(len(train)), indent=1) + "\n")
    (out / "splits_final.json").write_text(json.dumps(folds, indent=1) + "\n")

    summary = _summarise(results, split, folds, {m.patient_id for m in manifest})
    (out / "validation.json").write_text(json.dumps({"summary": summary, "cases": results}, indent=1) + "\n")
    (out / "validation.md").write_text(render_report(summary, results))
    summary["folder"] = str(out)
    return summary


def _check_across_cases(results: list[dict], manifest: list[Fetched]) -> None:
    repeated = {p for p, n in Counter(m.patient_id for m in manifest).items() if n > 1}
    for result in results:
        if result["patient_id"] in repeated:
            result["problems"].append("the patient is in fetched.json more than once")
    for key, what in (
        ("study_uid", "study"),
        ("ct_series_uid", "CT series"),
        ("seg_series_uid", "SEG"),
        ("pixel_sha1", "CT pixel data"),
    ):
        groups: dict[str, list[dict]] = defaultdict(list)
        for result in results:
            if result["facts"].get(key):
                groups[result["facts"][key]].append(result)
        for group in groups.values():
            ids = sorted({r["patient_id"] for r in group})
            if len(group) > 1:
                for result in group:
                    others = [p for p in ids if p != result["patient_id"]] or ids
                    result["problems"].append(f"same {what} as {', '.join(others)}")


def _dataset_json(num_training: int) -> dict:
    return {
        "name": DATASET,
        "description": "Kidney and kidney tumour on arterial-phase abdominal CT, from C4KC-KiTS (the KiTS19 cases)",
        "reference": KITS_DATASET["citation"],
        "licence": "CC BY 3.0",
        "channel_names": {"0": "CT"},
        "labels": TRAIN_LABELS,
        "numTraining": num_training,
        "file_ending": ".nii.gz",
        "overwrite_image_reader_writer": "SimpleITKIO",
        "note": "Held-out test cases are in imagesTs/labelsTs and must never be trained on (pipeline/ctrr/kits_split.json).",
    }


def _range(values: list[float]) -> dict | None:
    values = [v for v in values if v is not None]
    if not values:
        return None
    return {"min": min(values), "median": statistics.median(values), "max": max(values)}


def _summarise(results: list[dict], split: dict, folds: list[dict], fetched: set[str]) -> dict:
    passed = [r for r in results if not r["problems"]]
    facts = [r["facts"] for r in passed]
    return {
        "checks": list(CHECKS),
        "patients_in_split": len(split["train"]) + len(split["test"]),
        "fetched": len(fetched),
        "not_fetched": sorted((set(split["train"]) | set(split["test"])) - fetched),
        "passed": len(passed),
        "excluded": {r["patient_id"]: r["problems"] for r in results if r["problems"]},
        "train": sum(r["split"] == "train" for r in passed),
        "test": sum(r["split"] == "test" for r in passed),
        "site_cases_passed": [p for p in split["site_cases"] if any(r["patient_id"] == p for r in passed)],
        "folds": [{"train": len(f["train"]), "val": len(f["val"])} for f in folds],
        "with_tumour": sum(f["has_tumour"] for f in facts),
        "without_tumour": sum(not f["has_tumour"] for f in facts),
        "warnings": {r["patient_id"]: r["warnings"] for r in results if r["warnings"]},
        "warning_counts": dict(Counter(w.split(":")[0] for r in results for w in r["warnings"])),
        "orientations": dict(Counter(" ".join(f"{v:g}" for v in f["orientation"]) for f in facts)),
        "ranges": {
            "slices": _range([f["slices"] for f in facts]),
            "rows": _range([f["rows"] for f in facts]),
            "columns": _range([f["columns"] for f in facts]),
            "pixel_spacing_mm": _range([f["pixel_spacing_mm"][0] for f in facts]),
            "slice_spacing_mm": _range([f["slice_spacing_mm"] for f in facts]),
            "slice_thickness_mm": _range([f["slice_thickness_mm"] for f in facts]),
            "hu_min": _range([f["hu_min"] for f in facts]),
            "hu_max": _range([f["hu_max"] for f in facts]),
            "kidney_ml": _range([f["kidney_ml"] for f in facts]),
            "tumour_ml": _range([f["tumour_ml"] for f in facts if f["has_tumour"]]),
            "kidney_mean_hu": _range([f["kidney_mean_hu"] for f in facts]),
        },
    }


def render_report(summary: dict, results: list[dict]) -> str:
    lines = [
        f"# {DATASET}: validation report",
        "",
        f"{summary['passed']} of {summary['fetched']} fetched cases passed every check "
        f"({summary['patients_in_split']} patients in the split). "
        f"Training: {summary['train']}. Held-out test: {summary['test']}.",
        "",
        f"Tumour outlined in {summary['with_tumour']} of {summary['passed']} cases.",
        "",
        "Cross-validation folds (train / val): "
        + ", ".join(f"{f['train']} / {f['val']}" for f in summary["folds"]),
        "",
        "## Checks",
        "",
        *(f"- {check}" for check in summary["checks"]),
        "",
        "## Left out",
        "",
    ]
    if summary["excluded"]:
        lines += ["| case | split | why |", "|---|---|---|"]
        by_id = {r["patient_id"]: r for r in results}
        for patient, problems in summary["excluded"].items():
            lines.append(f"| {patient} | {by_id[patient]['split'] or '-'} | {'; '.join(problems)} |")
    else:
        lines.append("None.")
    if summary["not_fetched"]:
        lines += ["", f"Not fetched: {', '.join(summary['not_fetched'])}"]
    lines += ["", "## Warnings", "", "Not reasons to leave a case out, but worth knowing.", ""]
    if summary["warnings"]:
        lines += [f"- {kind}: {n} cases" for kind, n in summary["warning_counts"].items()]
        lines.append("")
        lines += [f"- {patient}: {'; '.join(w)}" for patient, w in summary["warnings"].items()]
    else:
        lines.append("None.")
    lines += ["", "## Ranges (cases that passed)", "", "| | min | median | max |", "|---|---|---|---|"]
    for name, r in summary["ranges"].items():
        if r:
            lines.append(f"| {name} | {r['min']:g} | {r['median']:g} | {r['max']:g} |")
    lines += ["", "Orientation (row direction, column direction):", ""]
    lines += [f"- {o}: {n} cases" for o, n in summary["orientations"].items()]
    return "\n".join(lines) + "\n"
