import type { ViewName } from "./mpr";

// The little figure in each view's corner: a person with a line where the
// view's plane cuts through them. Axial and sagittal show the person from the
// front (their right on the left, as on the images); coronal shows them from
// the side, facing left, as the sagittal image does.

type Props = {
  view: ViewName;
  /** Where the plane is, 0 to 1: head to feet across the scan for axial,
   *  patient's right to left for sagittal, front to back for coronal. Null hides the line. */
  at: number | null;
  colour: string;
};

const NAMES: Record<ViewName, string> = {
  axial: "Axial: a slice across the body",
  coronal: "Coronal: a slice from front to back",
  sagittal: "Sagittal: a slice from side to side",
};

export function Figure({ view, at, colour }: Props) {
  return (
    <svg className="figure" viewBox="0 0 40 80" role="img" aria-label={NAMES[view]}>
      <title>{NAMES[view]}</title>
      {view === "coronal" ? <Side /> : <Front />}
      {at !== null && <PlaneLine view={view} at={at} colour={colour} />}
    </svg>
  );
}

function Front() {
  return (
    <g className="figure-body">
      <circle cx="20" cy="8" r="5.5" />
      <line x1="20" y1="18" x2="20" y2="44" strokeWidth="11" />
      <line x1="13.5" y1="19" x2="9" y2="43" strokeWidth="4" />
      <line x1="26.5" y1="19" x2="31" y2="43" strokeWidth="4" />
      <line x1="16.5" y1="47" x2="15.5" y2="76" strokeWidth="5.5" />
      <line x1="23.5" y1="47" x2="24.5" y2="76" strokeWidth="5.5" />
    </g>
  );
}

function Side() {
  return (
    <g className="figure-body">
      <circle cx="20" cy="8" r="5.5" />
      <path d="M14.8 6.5 L12.5 9.5 L15 10 Z" />
      <line x1="20" y1="18" x2="20" y2="44" strokeWidth="9" />
      <line x1="19" y1="47" x2="19" y2="76" strokeWidth="6" />
      <line x1="18" y1="77" x2="13" y2="77" strokeWidth="3.5" />
      <line className="figure-arm" x1="19.5" y1="20" x2="17.5" y2="42" strokeWidth="3.5" />
    </g>
  );
}

function PlaneLine({ view, at, colour }: { view: ViewName; at: number; colour: string }) {
  // The scans are of the abdomen, so axial runs from the lower chest to the hips.
  if (view === "axial") {
    const y = 21 + at * 26;
    return <line className="figure-plane" x1="1" y1={y} x2="39" y2={y} stroke={colour} />;
  }
  // The image is wider than the body, so the edges of the image sit just outside it.
  const x = view === "sagittal" ? 6 + at * 28 : 11 + at * 18;
  return <line className="figure-plane" x1={x} y1="1" x2={x} y2="79" stroke={colour} />;
}
