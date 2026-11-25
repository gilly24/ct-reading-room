"""The synthetic phantom goes through the real build, so these test the whole pipeline."""

import gzip
import json
from pathlib import Path

import numpy as np
import pytest

from ctrr.build import build_case
from ctrr.bundle import write_index
from ctrr.cli import PHANTOM_SOURCE
from ctrr.phantom import LESIONS, PIXEL_MM, SLICES, make_phantom


@pytest.fixture(scope="module")
def case(tmp_path_factory):
    raw = make_phantom(tmp_path_factory.mktemp("raw"))
    out = tmp_path_factory.mktemp("cases")
    folder = build_case(raw, out, "phantom-01", "Tutorial", PHANTOM_SOURCE, "test")
    write_index(out)
    return folder


def _json(folder: Path, name: str) -> dict:
    return json.loads((folder / name).read_text())


def test_every_drawn_lesion_is_found_once(case):
    lesions = _json(case, "truth.json")["lesions"]
    assert sorted(l["kind"] for l in lesions) == sorted(l.kind for l in LESIONS)


@pytest.mark.parametrize("drawn", LESIONS, ids=lambda l: l.name)
def test_each_lesion_is_measured_where_it_was_drawn(case, drawn):
    lesions = _json(case, "truth.json")["lesions"]
    nearest = min(lesions, key=lambda l: np.linalg.norm(np.subtract(l["centroidWorld"], drawn.centre)))
    assert nearest["kind"] == drawn.kind
    assert np.linalg.norm(np.subtract(nearest["centroidWorld"], drawn.centre)) < 2.0
    # A sphere's longest axial diameter is its diameter, give or take a pixel.
    assert abs(nearest["longAxisMm"] - 2 * drawn.radius) <= PIXEL_MM * 1.5
    assert abs(nearest["volumeCm3"] - 4 / 3 * np.pi * drawn.radius**3 / 1000) / nearest["volumeCm3"] < 0.25
    # +x is the patient's left in DICOM.
    assert nearest["side"] == ("left" if drawn.centre[0] > 0 else "right")


def test_organs_and_poles(case):
    lesions = {l["id"]: l for l in _json(case, "truth.json")["lesions"]}
    assert lesions["T1"]["organ"] == "kidney" and lesions["T1"]["side"] == "left"
    assert lesions["T2"]["organ"] == "kidney" and lesions["T2"]["pole"] == "lower"
    assert {lesions["C1"]["organ"], lesions["C2"]["organ"]} == {"kidney", "liver"}


def test_slices_are_head_first_and_labels_line_up(case):
    meta = _json(case, "case.json")
    truth = _json(case, "truth.json")
    assert meta["geometry"]["slices"] == SLICES == len(meta["images"])
    labels = np.frombuffer(gzip.decompress((case / truth["labels"]["file"]).read_bytes()), dtype=np.uint8)
    labels = labels.reshape(truth["labels"]["shape"])
    t1 = next(l for l in truth["lesions"] if l["id"] == "T1")
    row, col = (np.add(t1["longAxis"]["from"], t1["longAxis"]["to"]) / 2).round().astype(int)
    assert labels[t1["keySlice"], row, col] == 2

    import pydicom

    zs = [float(pydicom.dcmread(case / name, stop_before_pixels=True).ImagePositionPatient[2]) for name in meta["images"]]
    assert zs == sorted(zs, reverse=True)


def test_index_gives_nothing_away(case):
    index = _json(case.parent, "index.json")
    assert [c["id"] for c in index["cases"]] == ["phantom-01"]
    text = json.dumps(index)
    for word in ("tumour", "lesion", "cyst", "longAxis"):
        assert word not in text
