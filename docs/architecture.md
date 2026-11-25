# Architecture

Two halves joined by a file format: a Python pipeline that makes cases, and a
static website that reads them. Online, a small Cloudflare Worker
(`web/worker/index.ts`) serves the site and hands out case files from a
storage bucket; it never receives anything from a visitor (deploying.md).

```
            pipeline (Python, offline)                      web (browser)
┌──────────────────────────────────────────┐   ┌──────────────────────────────────┐
│ idc.py      fetch CT + SEG from IDC      │   │ case/load.ts   fetch case files   │
│ phantom.py  or draw a synthetic abdomen  │   │ viewer/        Cornerstone3D      │
│ dicom_io.py read + order the CT          │──►│ read/scoring   match marks to     │
│ seg_io.py   SEG → label volume           │   │                reference lesions  │
│ findings.py measure every lesion         │   │ read/report    draft the report   │
│ bundle.py   write the case bundle        │   │ components/    the reading room   │
└──────────────────────────────────────────┘   └──────────────────────────────────┘
                         case bundle: docs/case-format.md
```

## Pipeline (`pipeline/ctrr`)

**Reading the CT** (`dicom_io.py`). Loads one single-frame CT series, refuses
anything that is not a plain axial stack with one size, spacing and
orientation, and orders it head first (slice 0 is the most superior). HU come
from the rescale slope and intercept.

**Reading the outlines** (`seg_io.py`). A DICOM SEG names the CT series it was
drawn on. Each segment is mapped to one of our classes (kidney, tumour, cyst,
liver, pancreas, spleen) from its label and coded type. C4KC-KiTS calls its
tumours "Mass". Overlaps go to the lesion. Some SEG writers omit the flag that
says frames sit exactly on their source slices, so highdicom will not trust
them; `_check_frames_sit_on_source_images` checks every frame's position
against its CT slice instead (to 0.1 mm), and refuses the case if one is off.

**Measuring** (`findings.py`). Each connected lesion (26-connected, at least
50 mm³) is measured the way a radiologist reports it:

| measure | how |
|---|---|
| long axis | the longest in-plane diameter on any slice (RECIST), from the convex hull, edge to edge |
| short axis | the widest extent perpendicular to it, on the same slice |
| key slice | the slice the long axis is on |
| volume | voxels × voxel volume |
| mean HU | mean CT value inside the outline |
| side | patient x of the centroid against the body's midline (DICOM +x is the patient's left) |
| organ | the organ label touching the lesion most, within two voxels |
| kidney pole | which third of that kidney's craniocaudal extent the centroid is in |

It also stores the lesion's bounding box on every slice it touches, which is
what the site uses to match a reader's measurement to it.

**The phantom** (`phantom.py`). A synthetic abdomen (body wall, bowel, spine,
aorta, IVC, liver, spleen, kidneys) with two kidney tumours and two cysts drawn
in at known places, written as real CT DICOM and a real DICOM SEG. It goes
through exactly the same build as a downloaded case, so the tests in
`tests/test_phantom.py` check the whole pipeline against known answers.

## Website (`web/src`)

**Viewer** (`viewer/Viewer.tsx`). Three views, laid out as on a PACS: axial
large on the right, sagittal and coronal stacked on the left; double-click (or
F) shows one view alone, and phones always show one with a switch. Axial is a
Cornerstone3D stack viewport. Its first image shows as soon as it and the four
after it have arrived; the rest are fetched while the case is read, six at a
time, always the waiting image nearest the one on screen (`viewer/slices.ts`),
so a reader who jumps ahead gets that part of the case next. An image scrolled
to before its turn is fetched there and then. The files are lossless HTJ2K,
decoded by WebAssembly.

Coronal and sagittal are volume viewports cut from one streaming volume built
from the same images. Cornerstone needs only the first, middle and last image to
place it, so the side views appear just after the axial one and fill in as the
images arrive; images are shared through Cornerstone's cache, so none is
fetched twice. Thin-slice cases (1 mm) reconstruct cleanly; 3 to 4 mm cases
look stepped from the side, as they would on any workstation.

Mouse, as on a PACS: the wheel or a left drag scrolls, a right drag sets the
window, a middle (or Shift) drag pans, Ctrl with a drag or the wheel zooms, and
a right click without a drag opens a menu of tools and presets. The toolbar
changes what the left button does; measuring is on axial images only, because
scoring and the report count by axial image number. Every tool's bindings are
cleared before new ones are set, since Cornerstone adds to them otherwise.

Crosshair lines show where each view's plane cuts the other two, in that view's
colour. The point they cross at is where the three planes meet
(`viewer/mpr.ts`, pure, unit-tested), so there is no separate crosshair state
to drift: scrolling any view moves its line in the others. A press near a line
is caught before Cornerstone sees it and drags that line, moving its view (the
axial view to the nearest image); near the crossing, both lines move. The
window is one setting across the three views. Corner text, the patient
direction at each edge (worked out from each view's camera, so radiological
convention follows) and a small figure showing where the view cuts the body
(`viewer/Figure.tsx`) are drawn by React over the canvases. Reference boxes and
long axes are an SVG layer positioned with the axial viewport's own
world-to-canvas transform.

**Outlines** (`viewer/outlines.ts`). After hand-in, the label volume is drawn
over the CT on a canvas, one slice at a time: edges solid, lesions lightly
filled, organs faint. The same image-to-canvas transform places it, so it
follows pan and zoom. Only slices on screen are ever turned into pixels.

**Marks** (`read/marks.ts`). Each length annotation becomes a mark: slice,
both ends in pixels, length in mm from the world coordinates, and the side of
the patient its middle is on. The reader adds what it is (mass, cyst, not sure)
and the organ.

**Scoring** (`read/scoring.ts`, pure, unit-tested). A mark is on a lesion when
its midpoint is inside that lesion's box on the same or the next slice, give or
take 5 mm. Each lesion takes its closest mark; later marks on it are
duplicates, not mistakes. A tumour called a cyst is not counted as found. Marks
on nothing are false positives. The size error is the mark's length minus the
reference long axis.

**Report** (`read/report.ts`, pure, unit-tested). Findings grouped by organ,
largest first: place, size, kind, image number, and HU and volume when they are
known. The impression is always left for a person. The same function drafts
from the reader's marks and from the reference, and will draft from the AI's
findings.

## Decisions, and why

- **Cornerstone3D directly, not a fork of OHIF.** The simulator is the product:
  hand-in, scoring and the report panel are custom UI that OHIF's mode and
  extension system would fight. Cornerstone is OHIF's engine, so the viewer
  behaves the same and the skills carry over.
- **A static site.** Cases are files; the site is files. The only code that
  runs online is the Worker that reads case files from R2 by path, so there is
  no running cost, no uploads and almost nothing to secure.
- **No uploads, ever.** See safety.md.
- **Labels as one gzipped byte volume**, not DICOM SEG, in the browser. It is
  one fetch, about 100 kB for a whole case, and needs no parser. The pipeline
  still reads and (from milestone 2) writes real DICOM SEG.
- **Answers load only on hand-in.** `truth.json` and the labels are fetched
  when the reader hands in, and `index.json` holds nothing about findings.
