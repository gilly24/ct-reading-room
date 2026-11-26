import { LESION_COLOURS } from "../case/classes";
import { VIEW_COLOURS } from "../viewer/Viewer";

// A drawing of the axial view, for the home page: what a read looks like. It is
// a schematic, not a scan, and it shows no AI outline (the AI's reads on the
// site are only ever its real ones).
export function ScanPreview() {
  return (
    <svg className="scan-preview" viewBox="0 0 320 240" role="img" aria-label="Drawing of an axial CT view with a kidney lesion outlined and measured">
      <rect width="320" height="240" fill="#000" />

      {/* The body: skin and muscle, then fat, then the organs. */}
      <ellipse cx="160" cy="124" rx="128" ry="92" fill="#4b5158" />
      <ellipse cx="160" cy="124" rx="121" ry="85" fill="#24282d" />
      <ellipse cx="160" cy="128" rx="104" ry="70" fill="#353a40" />

      {/* Liver: the patient's right, the screen's left. */}
      <path d="M62 104c4-26 32-42 62-38 14 2 20 12 16 26-6 22-30 34-52 40-16 4-28-8-26-28z" fill="#6c7279" />
      {/* Bowel, with gas. */}
      <circle cx="150" cy="78" r="13" fill="#555b62" />
      <circle cx="152" cy="76" r="5" fill="#0b0d10" />
      <circle cx="184" cy="84" r="11" fill="#555b62" />
      <circle cx="210" cy="96" r="12" fill="#555b62" />
      <circle cx="207" cy="93" r="4" fill="#0b0d10" />

      {/* Aorta (bright: arterial phase) and the spine. */}
      <circle cx="170" cy="148" r="8" fill="#c9ced4" />
      <circle cx="160" cy="176" r="15" fill="#dde1e6" />
      <path d="M150 190l-6 16h32l-6-16z" fill="#c4c9cf" />

      {/* Kidneys: bright cortex, darker sinus. */}
      <ellipse cx="114" cy="160" rx="15" ry="22" transform="rotate(-18 114 160)" fill="#a3a9af" />
      <ellipse cx="119" cy="161" rx="6" ry="10" transform="rotate(-18 119 161)" fill="#5d6369" />
      <ellipse cx="206" cy="160" rx="15" ry="22" transform="rotate(18 206 160)" fill="#a3a9af" />
      <ellipse cx="201" cy="161" rx="6" ry="10" transform="rotate(18 201 161)" fill="#5d6369" />

      {/* The lesion, its outline, and a reader's measurement across it. */}
      <circle cx="221" cy="146" r="12" fill="#7c8288" />
      <circle cx="221" cy="146" r="12.5" fill="none" stroke={LESION_COLOURS.tumour} strokeWidth="1.6" />
      <line x1="210" y1="155" x2="233" y2="138" stroke="#000" strokeWidth="3.5" opacity="0.6" />
      <line x1="210" y1="155" x2="233" y2="138" stroke={LESION_COLOURS.mark} strokeWidth="1.6" strokeDasharray="4 3" />
      <circle cx="210" cy="155" r="1.8" fill={LESION_COLOURS.mark} />
      <circle cx="233" cy="138" r="1.8" fill={LESION_COLOURS.mark} />

      {/* Where the other two views cut through this one. */}
      <line x1="0" y1="146" x2="320" y2="146" stroke={VIEW_COLOURS.coronal} strokeWidth="0.8" opacity="0.55" />
      <line x1="221" y1="0" x2="221" y2="240" stroke={VIEW_COLOURS.sagittal} strokeWidth="0.8" opacity="0.55" />

      <g className="scan-preview-text">
        <rect x="8" y="9" width="6" height="6" rx="1.5" fill={VIEW_COLOURS.axial} />
        <text x="18" y="15" fontWeight="600">Axial</text>
        <text x="312" y="15" textAnchor="end">Im 24 / 48</text>
        <text x="8" y="232">C 40 W 400</text>
        <text x="312" y="232" textAnchor="end">Schematic</text>
        <text x="160" y="22" textAnchor="middle" fontWeight="700">A</text>
        <text x="8" y="128" fontWeight="700">R</text>
        <text x="312" y="128" textAnchor="end" fontWeight="700">L</text>
      </g>
    </svg>
  );
}
