"""A synthetic abdominal CT with known lesions, written as real CT DICOM plus a DICOM SEG.

It is nobody's scan, so it needs no licence and can live in the repository. It goes
through exactly the same build as a downloaded case, which is what the tests rely on.

Coordinates are DICOM patient coordinates (LPS): +x is the patient's left,
+y is posterior, +z is superior. All sizes are in mm.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import highdicom as hd
import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sr.codedict import codes
from pydicom.uid import ExplicitVRLittleEndian, generate_uid
from scipy import ndimage

from .dicom_io import CT_IMAGE_STORAGE

ROWS = COLS = 192
PIXEL_MM = 1.8
SLICES = 48
SLICE_MM = 4.0

MORPHOLOGICALLY_ALTERED = hd.sr.CodedConcept("49755003", "SCT", "Morphologically Altered Structure")


@dataclass(frozen=True)
class Sphere:
    name: str
    kind: str  # tumour or cyst
    centre: tuple[float, float, float]
    radius: float
    hu: float


# The answers. tests/test_phantom.py checks the build finds exactly these.
LESIONS = (
    Sphere("left kidney tumour", "tumour", (92.0, 50.0, -78.0), 17.0, 75.0),
    Sphere("right lower pole tumour", "tumour", (-84.0, 70.0, -128.0), 7.5, 85.0),
    Sphere("right kidney cyst", "cyst", (-94.0, 58.0, -100.0), 9.0, 6.0),
    Sphere("liver cyst", "cyst", (-95.0, -10.0, -30.0), 8.0, 4.0),
)


def _uid(*parts: str) -> str:
    return generate_uid(entropy_srcs=["ct-reading-room phantom", *parts])


def make_phantom(out_dir: Path, seed: int = 7) -> Path:
    """Write ct/*.dcm and seg.dcm into out_dir and return it."""
    out_dir = Path(out_dir)
    (out_dir / "ct").mkdir(parents=True, exist_ok=True)

    z = -np.arange(SLICES) * SLICE_MM  # head first
    y = (np.arange(ROWS) - (ROWS - 1) / 2) * PIXEL_MM
    x = (np.arange(COLS) - (COLS - 1) / 2) * PIXEL_MM
    Z, Y, X = np.meshgrid(z, y, x, indexing="ij")

    hu, masks = _draw(X, Y, Z, np.random.default_rng(seed))
    datasets = _write_ct(out_dir / "ct", hu, x, y, z)
    _write_seg(out_dir / "seg.dcm", datasets, masks)
    return out_dir


def _ellipsoid(X, Y, Z, centre, axes):
    cx, cy, cz = centre
    ax, ay, az = axes
    return ((X - cx) / ax) ** 2 + ((Y - cy) / ay) ** 2 + ((Z - cz) / az) ** 2 <= 1


def _cylinder(X, Y, centre, axes):
    cx, cy = centre
    ax, ay = axes
    return ((X - cx) / ax) ** 2 + ((Y - cy) / ay) ** 2 <= 1


def _draw(X, Y, Z, rng):
    hu = np.full(X.shape, -1000.0)

    body = _cylinder(X, Y, (0, 5), (150, 110))
    inner = _cylinder(X, Y, (0, 5), (136, 96))
    muscle_wall = inner & ~_cylinder(X, Y, (0, 5), (128, 88))
    hu[body] = -100  # subcutaneous fat
    hu[inner] = -85  # intra-abdominal fat
    hu[muscle_wall] = 50

    # Bowel loops in the front half: soft-tissue walls, some holding gas.
    for _ in range(26):
        cx, cy = rng.uniform(-95, 95), rng.uniform(-80, 15)
        cz, r = rng.uniform(-190, 10), rng.uniform(9, 16)
        loop = _ellipsoid(X, Y, Z, (cx, cy, cz), (r, r, r * 2.5)) & inner
        hu[loop] = 35
        if rng.random() < 0.45:
            hu[_ellipsoid(X, Y, Z, (cx, cy, cz), (r * 0.55, r * 0.55, r * 2.0)) & inner] = -900

    for side in (-1, 1):
        hu[_cylinder(X, Y, (side * 36, 96), (22, 17)) & inner] = 50  # paraspinal muscle
        psoas_r = 9 + (-Z) * 0.05
        hu[(((X - side * 38) ** 2 + (Y - 55) ** 2) <= psoas_r**2) & inner] = 50

    vertebral_body = _cylinder(X, Y, (0, 60), (20, 18))
    hu[vertebral_body] = 700
    hu[_cylinder(X, Y, (0, 60), (17, 15))] = 300
    disc = ((-Z) % 32) < 6
    hu[vertebral_body & disc] = 80
    hu[_cylinder(X, Y, (0, 90), (15, 13))] = 600
    hu[_cylinder(X, Y, (0, 88), (8, 7))] = 25  # spinal canal

    hu[_cylinder(X, Y, (12, 35), (11, 11))] = 170  # aorta
    hu[_cylinder(X, Y, (-22, 38), (12, 12))] = 140  # IVC

    liver = _ellipsoid(X, Y, Z, (-70, 0, -40), (75, 70, 75)) & inner & (X < 25)
    spleen = _ellipsoid(X, Y, Z, (100, 40, -18), (26, 36, 38)) & inner
    hu[liver] = 110
    hu[spleen] = 118

    kidneys = np.zeros(X.shape, dtype=bool)
    for side in (-1, 1):
        kidney = _ellipsoid(X, Y, Z, (side * 72, 62, -95), (26, 21, 52))
        sinus = _ellipsoid(X, Y, Z, (side * 60, 58, -95), (9, 8, 20))
        hu[kidney] = 175
        hu[sinus & kidney] = -60
        kidneys |= kidney

    lesion_masks = {}
    for lesion in LESIONS:
        mask = _ellipsoid(X, Y, Z, lesion.centre, (lesion.radius,) * 3)
        hu[mask] = lesion.hu
        lesion_masks[lesion.name] = mask
    big = LESIONS[0]
    hu[_ellipsoid(X, Y, Z, big.centre, (6, 6, 6))] = 25  # a necrotic centre

    hu = ndimage.gaussian_filter(hu, sigma=(0.4, 0.8, 0.8))
    hu += rng.normal(0, 10, hu.shape)

    tumour = np.zeros(X.shape, dtype=bool)
    cyst = np.zeros(X.shape, dtype=bool)
    for lesion in LESIONS:
        (tumour if lesion.kind == "tumour" else cyst)[...] |= lesion_masks[lesion.name]

    masks = {
        "Kidney": kidneys & ~tumour & ~cyst,
        "Tumour": tumour,
        "Cyst": cyst,
        "Liver": liver & ~tumour & ~cyst,
        "Spleen": spleen & ~tumour & ~cyst,
    }
    return hu, masks


def _write_ct(folder: Path, hu: np.ndarray, x, y, z) -> list[Dataset]:
    study_uid, series_uid, frame_uid = _uid("study"), _uid("series"), _uid("frame")
    stored = np.clip(np.round(hu) + 1024, 0, 4095).astype(np.uint16)
    datasets = []
    for i in range(SLICES):
        sop_uid = _uid("image", str(i))
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = CT_IMAGE_STORAGE
        meta.MediaStorageSOPInstanceUID = sop_uid
        meta.TransferSyntaxUID = ExplicitVRLittleEndian

        ds = Dataset()
        ds.file_meta = meta
        ds.SOPClassUID = CT_IMAGE_STORAGE
        ds.SOPInstanceUID = sop_uid
        ds.ImageType = ["ORIGINAL", "PRIMARY", "AXIAL"]
        ds.Modality = "CT"
        ds.Manufacturer = "CT Reading Room"
        ds.ManufacturerModelName = "Synthetic phantom"
        ds.PatientName = "Phantom^Abdomen"
        ds.PatientID = "CTRR-PHANTOM-01"
        ds.PatientBirthDate = ""
        ds.PatientSex = "O"
        ds.StudyInstanceUID = study_uid
        ds.StudyID = "1"
        ds.StudyDate = "20260101"
        ds.StudyTime = "090000"
        ds.StudyDescription = "CT abdomen (synthetic)"
        ds.AccessionNumber = ""
        ds.ReferringPhysicianName = ""
        ds.SeriesInstanceUID = series_uid
        ds.SeriesNumber = 2
        ds.SeriesDescription = "Portal venous (synthetic phantom)"
        ds.BodyPartExamined = "ABDOMEN"
        ds.FrameOfReferenceUID = frame_uid
        ds.PositionReferenceIndicator = ""
        ds.InstanceNumber = i + 1
        ds.ImagePositionPatient = [float(x[0]), float(y[0]), float(z[i])]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.SliceLocation = float(z[i])
        ds.SliceThickness = SLICE_MM
        ds.PixelSpacing = [PIXEL_MM, PIXEL_MM]
        ds.Rows, ds.Columns = ROWS, COLS
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 12
        ds.HighBit = 11
        ds.PixelRepresentation = 0
        ds.RescaleIntercept = -1024
        ds.RescaleSlope = 1
        ds.RescaleType = "HU"
        ds.WindowCenter = 40
        ds.WindowWidth = 400
        ds.KVP = 120
        ds.PixelData = stored[i].tobytes()
        # File names are UIDs, so nothing downstream can lean on file order.
        ds.save_as(folder / f"{sop_uid}.dcm", enforce_file_format=True)
        datasets.append(ds)
    return datasets


def _write_seg(path: Path, datasets: list[Dataset], masks: dict[str, np.ndarray]) -> None:
    kinds = {
        "Kidney": (codes.SCT.AnatomicalStructure, codes.SCT.Kidney),
        "Tumour": (MORPHOLOGICALLY_ALTERED, codes.SCT.Neoplasm),
        "Cyst": (MORPHOLOGICALLY_ALTERED, codes.SCT.Cyst),
        "Liver": (codes.SCT.AnatomicalStructure, codes.SCT.Liver),
        "Spleen": (codes.SCT.AnatomicalStructure, codes.SCT.Spleen),
    }
    names = list(masks)
    descriptions = [
        hd.seg.SegmentDescription(
            segment_number=i,
            segment_label=name,
            segmented_property_category=kinds[name][0],
            segmented_property_type=kinds[name][1],
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
        )
        for i, name in enumerate(names, start=1)
    ]
    pixel_array = np.stack([masks[name] for name in names], axis=-1).astype(np.uint8)
    seg = hd.seg.Segmentation(
        source_images=datasets,
        pixel_array=pixel_array,
        segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
        segment_descriptions=descriptions,
        series_instance_uid=_uid("seg series"),
        series_number=100,
        sop_instance_uid=_uid("seg"),
        instance_number=1,
        manufacturer="CT Reading Room",
        manufacturer_model_name="Synthetic phantom",
        software_versions="0.1.0",
        device_serial_number="0",
        series_description="Ground truth (synthetic)",
    )
    seg.save_as(path)
