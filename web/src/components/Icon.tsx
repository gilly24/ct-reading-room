// Toolbar icons, drawn here so the site needs no icon font. 20 x 20, in the text colour.

export type IconName =
  | "scroll"
  | "window"
  | "pan"
  | "zoom"
  | "measure"
  | "presets"
  | "lines"
  | "three"
  | "single"
  | "reset";

const PATHS: Record<IconName, React.ReactNode> = {
  scroll: (
    <>
      <path d="M10 2.5v15M7 5.5l3-3 3 3M7 14.5l3 3 3-3" />
      <path d="M3 7.5h3.5M3 10h3.5M3 12.5h3.5M13.5 7.5H17M13.5 10H17M13.5 12.5H17" />
    </>
  ),
  window: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" stroke="none" />
    </>
  ),
  pan: <path d="M10 2.5v15M2.5 10h15M7.5 5l2.5-2.5L12.5 5M7.5 15l2.5 2.5 2.5-2.5M5 7.5 2.5 10 5 12.5M15 7.5l2.5 2.5-2.5 2.5" />,
  zoom: (
    <>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M12.5 12.5 17.5 17.5M6 8.5h5M8.5 6v5" />
    </>
  ),
  measure: <path d="M4 16 16 4M2.5 13.5l4 4M13.5 2.5l4 4M7.5 12.5l-1.5-1.5M10 10 8.5 8.5M12.5 7.5 11 6" />,
  presets: (
    <>
      <path d="M3 5.5h14M3 10h14M3 14.5h14" />
      <circle cx="7" cy="5.5" r="1.8" fill="var(--toolbar)" />
      <circle cx="13" cy="10" r="1.8" fill="var(--toolbar)" />
      <circle cx="9" cy="14.5" r="1.8" fill="var(--toolbar)" />
    </>
  ),
  lines: (
    <>
      <path d="M10 2.5v5M10 12.5v5M2.5 10h5M12.5 10h5" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),
  three: (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1" />
      <path d="M8 3.5v13M2.5 10H8" />
    </>
  ),
  single: <rect x="2.5" y="3.5" width="15" height="13" rx="1" />,
  reset: (
    <>
      <path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1" />
      <path d="M4.5 3v3.5H8" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon-svg" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
