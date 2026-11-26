"""The AI step, end to end on the phantom: NIfTI out and back, a model's outlines
measured like the reference, and the rule that a model never reads a case it trained on.

The "predictions" here are made from the phantom's own labels, some with
mistakes put in on purpose. They test the plumbing; they are not a model.
"""

import gzip
import json

import highdicom as hd
import numpy as np
import pytest

from ctrr.ai import Model, write_ai
from ctrr.build import build_case
from ctrr.bundle import write_index
from ctrr.cli import PHANTOM_SOURCE, main
from ctrr.dicom_io import load_case_ct
from ctrr.phantom import make_phantom
from ctrr.seg_io import CLASS_VALUE

KIDNEY, TUMOUR = CLASS_VALUE["kidney"], CLASS_VALUE["tumour"]


def _nifti():
    """ctrr.nifti needs SimpleITK, the `train` extra; tests that use it skip without it."""
    pytest.importorskip("SimpleITK")
    from ctrr import nifti

    return nifti


@pytest.fixture()
def case(tmp_path_factory):
    raw = make_phantom(tmp_path_factory.mktemp("raw"))
    out = tmp_path_factory.mktemp("cases")
    folder = build_case(raw, out, "phantom-01", "Tutorial", PHANTOM_SOURCE, "test")
    write_index(out)
    return folder


@pytest.fixture()
def model_file(tmp_path):
    path = tmp_path / "model.json"
    path.write_text(
        json.dumps(
            {
                "schema": 1,
                "name": "Test model",
                "version": "0",
                "architecture": "none: made from the phantom's labels",
                "dataset": "C4KC-KiTS",
                "trainedOn": ["KiTS-00000", "KiTS-00001"],
                # A KiTS model's own label values: 1 kidney, 2 tumour.
                "labels": {"1": "kidney", "2": "tumour"},
                "card": "docs/model-card.md",
            }
        )
    )
    return path


def _labels(folder, name="labels.u8.gz"):
    meta = json.loads((folder / "case.json").read_text())
    shape = (meta["geometry"]["slices"], meta["geometry"]["rows"], meta["geometry"]["columns"])
    return np.frombuffer(gzip.decompress((folder / name).read_bytes()), dtype=np.uint8).reshape(shape)


def _kits_prediction(folder):
    """What a perfect kidney-and-tumour model would draw: the reference's kidneys and tumours only."""
    truth = _labels(folder)
    prediction = np.zeros_like(truth)
    prediction[truth == KIDNEY] = 1
    prediction[truth == TUMOUR] = 2
    return prediction


def _json(folder, name):
    return json.loads((folder / name).read_text())


def test_ct_nifti_is_written_exactly_like_the_training_set(case, tmp_path):
    nifti = _nifti()
    import SimpleITK as sitk

    from ctrr.train_data import ct_geometry, read_geometry

    ct = load_case_ct(case)
    path = nifti.write_ct(ct, tmp_path / "ct_0000.nii.gz")
    image = sitk.ReadImage(str(path))
    assert image.GetPixelID() == sitk.sitkInt16
    # Head first, as train_data writes: the file's first slice is our first.
    assert np.array_equal(sitk.GetArrayFromImage(image), np.round(ct.hu).astype(np.int16))
    _, written = read_geometry(path)
    training = ct_geometry(ct)
    for name in ("spacing", "origin", "direction"):
        assert np.allclose(getattr(written, name), getattr(training, name), atol=1e-4), name
    assert np.allclose(image.TransformIndexToPhysicalPoint((0, 0, 0)), ct.positions[0], atol=1e-3)
    last = image.TransformIndexToPhysicalPoint((0, 0, len(ct.positions) - 1))
    assert np.allclose(last, ct.positions[-1], atol=1e-3)


def test_labels_round_trip_through_nifti(case, tmp_path):
    nifti = _nifti()
    ct = load_case_ct(case)
    labels = _labels(case)
    path = nifti.write_labels(labels, ct, tmp_path / "labels.nii.gz")
    assert np.array_equal(nifti.read_labels(path, ct), labels)


def test_a_prediction_on_another_grid_is_refused(case, tmp_path):
    nifti = _nifti()
    import SimpleITK as sitk

    ct = load_case_ct(case)
    path = nifti.write_labels(_labels(case), ct, tmp_path / "labels.nii.gz")
    image = sitk.ReadImage(str(path))
    image.SetOrigin([v + 5 for v in image.GetOrigin()])
    sitk.WriteImage(image, str(path))
    with pytest.raises(ValueError, match="origin"):
        nifti.read_labels(path, ct)


def test_a_perfect_model_is_measured_exactly_like_the_reference(case, model_file):
    write_ai(case, _kits_prediction(case), Model.load(model_file))
    ai = _json(case, "ai.json")
    truth = _json(case, "truth.json")
    reference_tumours = [l for l in truth["lesions"] if l["kind"] == "tumour"]
    assert ai["lesions"] == reference_tumours
    assert ai["heldOut"] is True
    assert ai["model"]["trainedOn"] == {"dataset": "C4KC-KiTS", "patients": 2}
    assert ai["labels"]["classes"] == {"1": "kidney", "2": "tumour"}
    assert ai["model"]["outlines"] == ["kidney", "tumour"]
    # The AI's labels use our values, and line up with the reference's kidneys and tumours.
    ai_labels = _labels(case, ai["labels"]["file"])
    assert np.array_equal(ai_labels == TUMOUR, _labels(case) == TUMOUR)


def test_mistakes_show_in_the_findings(case, model_file):
    prediction = _kits_prediction(case)
    truth = _json(case, "truth.json")
    # Miss the smaller tumour...
    t2 = next(l for l in truth["lesions"] if l["id"] == "T2")
    for z, r0, c0, r1, c1 in t2["boxes"]:
        region = prediction[z, r0 : r1 + 1, c0 : c1 + 1]
        region[region == 2] = 1
    # ...and call a patch of healthy tissue a tumour.
    prediction[20:24, 60:70, 60:70] = 2
    write_ai(case, prediction, Model.load(model_file))
    lesions = _json(case, "ai.json")["lesions"]
    assert len(lesions) == 2
    centres = [np.add(l["longAxis"]["from"], l["longAxis"]["to"]) / 2 for l in lesions]
    t1 = next(l for l in truth["lesions"] if l["id"] == "T1")
    t1_centre = np.add(t1["longAxis"]["from"], t1["longAxis"]["to"]) / 2
    assert any(np.linalg.norm(c - t1_centre) < 3 for c in centres)
    assert any(20 <= l["keySlice"] <= 23 and l["sliceRange"] == [20, 23] for l in lesions)


def test_a_model_that_finds_nothing_still_says_what_it_looked_for(case, model_file):
    # The report needs "no mass outlined by the AI", not "masses not assessed": a
    # class the model outlines stays in its outlines when this case has none of it.
    prediction = _kits_prediction(case)
    prediction[prediction == 2] = 1
    write_ai(case, prediction, Model.load(model_file))
    ai = _json(case, "ai.json")
    assert ai["lesions"] == []
    assert ai["labels"]["classes"] == {"1": "kidney"}
    assert ai["model"]["outlines"] == ["kidney", "tumour"]


def test_the_case_points_at_its_ai_and_the_index_still_gives_nothing_away(case, model_file):
    write_ai(case, _kits_prediction(case), Model.load(model_file))
    assert _json(case, "case.json")["ai"] == "ai.json"
    index = _json(case.parent, "index.json")
    assert index["cases"][0]["hasAi"] is True
    text = json.dumps(index)
    for word in ("tumour", "lesion", "cyst", "longAxis"):
        assert word not in text


def test_the_outlines_are_written_as_dicom_seg(case, model_file):
    write_ai(case, _kits_prediction(case), Model.load(model_file))
    seg = hd.seg.segread(case / "ai-seg.dcm")
    labels = [seg.get_segment_description(n).segment_label for n in seg.segment_numbers]
    assert labels == ["Kidney", "Tumour"]
    description = seg.get_segment_description(2)
    assert description.algorithm_type == hd.seg.SegmentAlgorithmTypeValues.AUTOMATIC
    assert description.algorithm_identification[0].AlgorithmName == "Test model"
    ct = load_case_ct(case)
    assert {str(s.SeriesInstanceUID) for s in seg.ReferencedSeriesSequence} == {ct.series_instance_uid}


def test_a_model_never_reads_a_patient_it_trained_on(case, model_file):
    meta = _json(case, "case.json")
    meta["source"]["patient"] = "KiTS-00001"
    (case / "case.json").write_text(json.dumps(meta))
    with pytest.raises(ValueError, match="trained on KiTS-00001"):
        write_ai(case, _kits_prediction(case), Model.load(model_file))
    assert not (case / "ai.json").exists()


def test_values_the_model_does_not_name_are_refused(case, model_file):
    prediction = _kits_prediction(case)
    prediction[0, 0, 0] = 7
    with pytest.raises(ValueError, match=r"\[7\]"):
        write_ai(case, prediction, Model.load(model_file))


def test_a_model_must_say_what_it_trained_on(tmp_path, model_file):
    data = json.loads(model_file.read_text())
    data["trainedOn"] = []
    model_file.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="trainedOn"):
        Model.load(model_file)


def test_the_command_line_round_trip(case, model_file, tmp_path):
    nifti = _nifti()
    cases = case.parent
    main(["--cases", str(cases), "ai-input", "phantom-01", "--out", str(tmp_path)])
    ct_file = tmp_path / "phantom-01_0000.nii.gz"
    assert ct_file.exists()
    # Stand in for nnU-Net: a prediction on the same grid as its input.
    prediction = nifti.write_labels(_kits_prediction(case), load_case_ct(case), tmp_path / "phantom-01.nii.gz")
    main(["--cases", str(cases), "ai", "phantom-01", "--prediction", str(prediction), "--model", str(model_file)])
    assert len(_json(case, "ai.json")["lesions"]) == 2
