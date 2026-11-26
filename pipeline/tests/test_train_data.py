"""The training split, the label map and the NIfTI geometry of `ctrr train-data`."""

from pathlib import Path

import numpy as np
import pydicom
import pytest

from ctrr.dicom_io import find_dicom_files, load_ct_series
from ctrr.phantom import SLICES, make_phantom
from ctrr.seg_io import CLASS_VALUE, read_seg_labels
from ctrr.train_data import (
    SITE_CASES,
    SPLIT_FILE,
    TRAIN_LABELS,
    ct_geometry,
    convert_case,
    load_split,
    make_split,
    nnunet_splits,
    read_geometry,
    training_labels,
    write_nifti,
)

ALL_PATIENTS = [f"KiTS-{i:05d}" for i in range(210)]  # C4KC-KiTS in IDC


@pytest.fixture(scope="module")
def split():
    return load_split()


# --- the split: no case is ever both trained on and tested on ---------------------------


def test_the_cases_on_the_website_are_held_out(split):
    assert set(SITE_CASES) <= set(split["test"])
    assert split["site_cases"] == list(SITE_CASES)


def test_train_and_test_never_overlap(split):
    assert not set(split["train"]) & set(split["test"])


def test_every_patient_is_on_exactly_one_side(split):
    both = split["train"] + split["test"]
    assert len(both) == len(set(both))
    assert sorted(both) == ALL_PATIENTS
    assert len(split["test"]) == 40


def test_folds_cover_the_training_patients_once_and_no_test_patient(split):
    val = [p for fold in split["folds"] for p in fold]
    assert len(split["folds"]) == 5
    assert len(val) == len(set(val))
    assert sorted(val) == sorted(split["train"])
    assert not set(val) & set(split["test"])


def test_nnunet_folds_never_contain_a_test_patient(split):
    test = set(split["test"])
    for fold in nnunet_splits(split):
        assert not (set(fold["train"]) | set(fold["val"])) & test
        assert not set(fold["train"]) & set(fold["val"])
        assert sorted(fold["train"] + fold["val"]) == sorted(split["train"])


def test_excluded_cases_leave_the_folds_and_stay_out_of_training(split):
    gone = {split["train"][0], split["folds"][2][0], split["test"][0]}
    keep = set(ALL_PATIENTS) - gone
    for fold in nnunet_splits(split, keep=keep):
        assert not (set(fold["train"]) | set(fold["val"])) & (gone | set(split["test"]))


def test_the_committed_split_is_what_make_split_makes(split):
    assert make_split(split["train"] + split["test"], seed=split["seed"]) == split


def test_make_split_refuses_to_lose_a_site_case():
    with pytest.raises(ValueError):
        make_split([p for p in ALL_PATIENTS if p != SITE_CASES[0]])


def test_split_file_sits_next_to_the_code():
    assert SPLIT_FILE == Path(__file__).resolve().parent.parent / "ctrr" / "kits_split.json"


# --- labels -------------------------------------------------------------------------------


def test_labels_map_to_consecutive_nnunet_values():
    assert list(TRAIN_LABELS.values()) == list(range(len(TRAIN_LABELS)))
    classes = np.array([0, CLASS_VALUE["kidney"], CLASS_VALUE["tumour"]], dtype=np.uint8)
    labels, unexpected = training_labels(classes)
    assert labels.tolist() == [0, 1, 2]
    assert unexpected == []


def test_classes_with_no_place_in_training_are_named():
    classes = np.array([0, CLASS_VALUE["kidney"], CLASS_VALUE["cyst"], CLASS_VALUE["liver"]], dtype=np.uint8)
    _, unexpected = training_labels(classes)
    assert unexpected == ["cyst", "liver"]


# --- geometry, on the phantom ---------------------------------------------------------------


@pytest.fixture(scope="module")
def phantom(tmp_path_factory):
    folder = make_phantom(tmp_path_factory.mktemp("phantom"))
    ct = load_ct_series(find_dicom_files(folder / "ct"))
    classes, _ = read_seg_labels(folder / "seg.dcm", ct)
    return folder, ct, classes


def test_written_nifti_puts_every_voxel_where_the_dicom_says(phantom, tmp_path):
    sitk = pytest.importorskip("SimpleITK")
    _, ct, classes = phantom
    geometry = ct_geometry(ct)
    write_nifti(ct.hu.astype(np.int16), geometry, tmp_path / "ct.nii.gz")
    image = sitk.ReadImage(str(tmp_path / "ct.nii.gz"))

    assert np.array_equal(sitk.GetArrayFromImage(image), ct.hu.astype(np.int16))
    for k, row, col in [(0, 0, 0), (SLICES - 1, 10, 150), (20, 191, 3)]:
        # ITK, like DICOM, is LPS; its index order is (column, row, slice).
        world = image.TransformIndexToPhysicalPoint((col, row, k))
        assert np.allclose(world, ct.to_world(k, row, col), atol=1e-3)
    # Slice 0 is the most superior: the third axis points down (-z in LPS).
    assert image.GetDirection()[8] < 0


def test_image_and_label_share_one_geometry(phantom, tmp_path):
    pytest.importorskip("SimpleITK")
    _, ct, classes = phantom
    geometry = ct_geometry(ct)
    write_nifti(ct.hu.astype(np.int16), geometry, tmp_path / "ct.nii.gz")
    write_nifti(training_labels(classes)[0], geometry, tmp_path / "labels.nii.gz")
    (image_size, image_geometry), (label_size, label_geometry) = (
        read_geometry(tmp_path / "ct.nii.gz"),
        read_geometry(tmp_path / "labels.nii.gz"),
    )
    assert image_size == label_size == (ct.shape[2], ct.shape[1], ct.shape[0])
    assert np.allclose(image_geometry.direction, label_geometry.direction)
    assert np.allclose(image_geometry.origin, label_geometry.origin)
    assert np.allclose(image_geometry.spacing, label_geometry.spacing)


def test_a_case_with_classes_kits_does_not_have_is_left_out(phantom, tmp_path):
    """The phantom outlines cysts and organs, which the KiTS training set must not."""
    pytest.importorskip("SimpleITK")
    folder, ct, _ = phantom
    patient = str(pydicom.dcmread(next((folder / "ct").glob("*.dcm"))).PatientID)
    result = convert_case(patient, str(folder), SLICES, "train", str(tmp_path))
    assert any("neither kidney nor tumour" in p for p in result["problems"])
    assert not list(tmp_path.rglob("*.nii.gz"))
    # The checks that come before the segments still ran and passed.
    assert result["facts"]["slices"] == SLICES
    assert not any("drift" in p or "superior" in p for p in result["problems"])
