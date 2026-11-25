"""The CT in a case is lossless HTJ2K: smaller files, the same pixel values.

The pipeline encodes with OpenJPH (imagecodecs). These tests decode with OpenJPEG
(pydicom's pylibjpeg plugin), so the check does not lean on the encoder's own decoder.
"""

import json

import numpy as np
import pydicom
import pytest
from pydicom.pixels import pixel_array
from pydicom.uid import HTJ2KLossless

from ctrr.build import build_case
from ctrr.bundle import write_htj2k
from ctrr.cli import PHANTOM_SOURCE
from ctrr.dicom_io import find_dicom_files
from ctrr.phantom import make_phantom


def decode(path):
    """Pixel values as an independent decoder reads them."""
    return pixel_array(path, decoding_plugin="pylibjpeg")


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    raw = make_phantom(tmp_path_factory.mktemp("raw"))
    folder = build_case(raw, tmp_path_factory.mktemp("cases"), "phantom-01", "Tutorial", PHANTOM_SOURCE, "test")
    originals = {}
    for path in find_dicom_files(raw):
        ds = pydicom.dcmread(path)
        if ds.Modality == "CT":
            originals[str(ds.SOPInstanceUID)] = path
    return folder, originals


def test_every_slice_decodes_to_the_original_pixels(built):
    folder, originals = built
    images = json.loads((folder / "case.json").read_text())["images"]
    assert len(images) == len(originals)
    for name in images:
        ds = pydicom.dcmread(folder / name)
        assert ds.file_meta.TransferSyntaxUID == HTJ2KLossless
        original = pydicom.dcmread(originals[str(ds.SOPInstanceUID)])
        decoded = decode(folder / name)
        assert decoded.dtype == original.pixel_array.dtype
        assert np.array_equal(decoded, original.pixel_array), name


def test_everything_but_the_pixels_is_kept(built):
    folder, originals = built
    ds = pydicom.dcmread(folder / "ct" / "0000.dcm")
    original = pydicom.dcmread(originals[str(ds.SOPInstanceUID)])
    keep = lambda d: {e.tag: e.value for e in d if e.tag != 0x7FE00010}  # noqa: E731 (all but Pixel Data)
    assert keep(ds) == keep(original)
    assert len(ds.PixelData) < len(original.PixelData) / 2


@pytest.mark.parametrize(("bits", "signed", "low", "high"), [(16, True, -1024, 3071), (16, False, 0, 65535), (12, True, -2048, 2047)])
def test_other_pixel_formats_round_trip(tmp_path, bits, signed, low, high):
    src = _phantom_slice(tmp_path)
    ds = pydicom.dcmread(src)
    values = np.random.default_rng(0).integers(low, high, size=(ds.Rows, ds.Columns), endpoint=True)
    values[0, :2] = low, high
    ds.BitsStored, ds.HighBit, ds.PixelRepresentation = bits, bits - 1, int(signed)
    ds.PixelData = values.astype(np.int16 if signed else np.uint16).tobytes()
    ds.save_as(src, enforce_file_format=True)

    write_htj2k(src, tmp_path / "out.dcm")
    assert np.array_equal(decode(tmp_path / "out.dcm"), pydicom.dcmread(src).pixel_array)


def test_values_outside_bits_stored_are_refused(tmp_path):
    src = _phantom_slice(tmp_path)
    ds = pydicom.dcmread(src)
    values = ds.pixel_array.copy()
    values[0, 0] = 5000  # more than 12 bits
    ds.PixelData = values.tobytes()
    ds.save_as(src, enforce_file_format=True)
    with pytest.raises(ValueError, match="Bits Stored"):
        write_htj2k(src, tmp_path / "out.dcm")


def _phantom_slice(tmp_path):
    raw = make_phantom(tmp_path / "raw")
    return next(p for p in find_dicom_files(raw) if pydicom.dcmread(p, stop_before_pixels=True).Modality == "CT")
