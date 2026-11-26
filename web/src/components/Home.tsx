import { useEffect, useMemo, useState } from "react";
import { AI_COLOUR, CLASS_COLOURS, LESION_COLOURS } from "../case/classes";
import { loadIndex } from "../case/load";
import type { CaseSummary } from "../case/types";
import { REPO_URL } from "../site";
import { PRESETS } from "../viewer/presets";
import { TOOL_BUTTONS } from "./ReadingRoom";
import { ScanPreview } from "./ScanPreview";

/** The sections the header's links jump to. */
export const HOME_SECTIONS = [
  { id: "cases", label: "Cases" },
  { id: "how", label: "How it works" },
  { id: "data", label: "Data" },
] as const;

export function scrollToSection(id: string) {
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

// Same rule as scripts/case-index.mjs: the phantom is the tutorial.
const isTutorial = (c: CaseSummary) => c.id.startsWith("phantom");

type Order = "suggested" | "shortest";

export function Home({ onCases }: { onCases(cases: CaseSummary[]): void }) {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>("suggested");

  useEffect(() => {
    loadIndex()
      .then((index) => {
        setCases(index.cases);
        onCases(index.cases);
      })
      .catch((e) => setError(String(e)));
  }, [onCases]);

  const tutorial = cases?.find(isTutorial) ?? null;
  const scans = useMemo(() => {
    const rest = (cases ?? []).filter((c) => !isTutorial(c));
    return order === "shortest" ? [...rest].sort((a, b) => a.slices - b.slices) : rest;
  }, [cases, order]);
  const longest = Math.max(1, ...(cases ?? []).map((c) => c.slices));
  const first = tutorial ?? cases?.[0] ?? null;

  return (
    <div className="home">
      <div className="home-inner">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="eyebrow-dot" aria-hidden="true" />
              Abdominal CT · kidney tumours
            </p>
            <h1>
              Read abdominal CT <span className="h1-soft">like a radiologist.</span>
            </h1>
            <p className="lede">
              Scroll through real scans, find every kidney tumour, measure it and draft the report. Then see the
              radiologists' outlines and how close you were. An AI second reader that does the same is being built
              alongside it.
            </p>
            <div className="hero-actions">
              {first && (
                <a className="pill pill-light" href={`#/case/${first.id}`}>
                  {tutorial ? "Start the tutorial" : "Open the first case"} <Arrow />
                </a>
              )}
              <button type="button" className="pill" onClick={() => scrollToSection("cases")}>
                Browse all cases
              </button>
            </div>
            <Stats cases={cases} />
          </div>

          <figure className="card preview">
            <div className="card-head">
              <h2>What a read looks like</h2>
              <span className="tag">Drawing, not a scan</span>
            </div>
            <div className="preview-frame">
              <ScanPreview />
            </div>
            <figcaption className="legend-inline">
              <span>
                <i className="swatch-line dashed" style={{ color: LESION_COLOURS.mark }} /> Your measurement
              </span>
              <span>
                <i className="swatch-dot" style={{ background: LESION_COLOURS.tumour }} /> Radiologists' outline
              </span>
            </figcaption>
          </figure>
        </section>

        <section id="cases" className="block">
          <div className="block-head">
            <div>
              <h2>Cases</h2>
              <p className="muted">Start with the tutorial, then read the real scans in any order.</p>
            </div>
            {scans.length > 1 && (
              <div className="segmented" role="group" aria-label="Order the cases">
                <button type="button" aria-pressed={order === "suggested"} onClick={() => setOrder("suggested")}>
                  Suggested
                </button>
                <button type="button" aria-pressed={order === "shortest"} onClick={() => setOrder("shortest")}>
                  Shortest first
                </button>
              </div>
            )}
          </div>

          {error && <p className="error">The case list would not load. {error}</p>}
          {!cases && !error && <p className="muted">Loading cases…</p>}
          {cases && cases.length === 0 && (
            <p className="muted">
              No cases yet. Build some with the pipeline: <code>ctrr phantom</code> (docs/getting-started.md).
            </p>
          )}

          {cases && cases.length > 0 && (
            <ul className="cases">
              {[...(tutorial ? [tutorial] : []), ...scans].map((c) => (
                <li key={c.id}>
                  <CaseCard c={c} longest={longest} featured={c === tutorial} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="how" className="block">
          <div className="block-head">
            <div>
              <h2>How it works</h2>
              <p className="muted">Everything happens in the browser. Nothing you do here is recorded.</p>
            </div>
          </div>
          <div className="bento">
            <Steps />
            <Controls />
            <Colours />
          </div>
        </section>

        <section id="data" className="block">
          <div className="card credits">
            <div>
              <h2>Where the scans come from</h2>
              <p>
                The kidney cases are from C4KC-KiTS (Heller N, Sathianathen N, Kalapara A, et al., The Cancer Imaging
                Archive, 2019, <a href="https://doi.org/10.7937/TCIA.2019.IX49E8NX">doi:10.7937/TCIA.2019.IX49E8NX</a>),
                licensed CC BY 3.0, served by the{" "}
                <a href="https://portal.imaging.datacommons.cancer.gov/collections/c4kc_kits">NCI Imaging Data Commons</a>
                . They are de-identified public research scans. The tutorial case is synthetic: nobody's scan.
              </p>
            </div>
            <div>
              <h2>Not for clinical use</h2>
              <p>
                An educational demo. It shows a fixed set of public cases, never takes a scan from a visitor, and its
                report draft states measurements, never a diagnosis.
              </p>
              <p>
                Made by Gilly. The code is open source (MIT) on <a href={REPO_URL}>GitHub</a>.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function CaseCard({ c, longest, featured }: { c: CaseSummary; longest: number; featured: boolean }) {
  return (
    <a href={`#/case/${c.id}`} className={`card case-card${featured ? " featured" : ""}`}>
      <span className="case-top">
        <span className="case-heading">
          {featured && <span className="tag tag-accent">Start here</span>}
          <span className="case-title">{c.title}</span>
        </span>
        <span className="round-arrow" aria-hidden="true">
          <Arrow />
        </span>
      </span>
      <span className="muted small">
        {featured ? "A practice scan to learn the controls on, before the real ones." : c.description}
      </span>
      <SliceStrip slices={c.slices} longest={longest} />
      <span className="chips">
        {c.dataset && <span className="chip">{c.dataset}</span>}
        {c.hasAi && (
          <span className="chip chip-ai">
            <i className="swatch-dot" style={{ background: AI_COLOUR }} /> AI read
          </span>
        )}
      </span>
    </a>
  );
}

function Stats({ cases }: { cases: CaseSummary[] | null }) {
  const real = cases?.filter((c) => !isTutorial(c)).length;
  const images = cases?.reduce((sum, c) => sum + c.slices, 0);
  const ai = cases?.filter((c) => c.hasAi).length ?? 0;
  const stats: { value: string; label: string }[] = [
    { value: real === undefined ? "–" : String(real), label: real === 1 ? "real scan" : "real scans" },
    { value: images === undefined ? "–" : images.toLocaleString("en"), label: "images to read" },
    { value: "3", label: "linked views" },
  ];
  if (ai > 0) stats.push({ value: String(ai), label: ai === 1 ? "AI read" : "AI reads" });
  return (
    <dl className="stats-row">
      {stats.map((s) => (
        <div key={s.label}>
          <dt>{s.label}</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** How long the scan is, as a strip of slices beside the longest one's. */
function SliceStrip({ slices, longest }: { slices: number; longest: number }) {
  return (
    <span className="slice-strip">
      <span className="strip-track" aria-hidden="true">
        <span className="strip-fill" style={{ width: `${Math.max(4, (slices / longest) * 100)}%` }} />
      </span>
      <span className="strip-label">{slices} images</span>
    </span>
  );
}

function Steps() {
  const steps = [
    { title: "Find", text: "Scroll the axial, coronal and sagittal views for every lesion.", key: "Wheel" },
    { title: "Measure", text: "Drag across each lesion's longest diameter, on the image where it is biggest.", key: "M" },
    { title: "Report", text: "Your measurements draft the report. What they mean is yours to write.", key: null },
    { title: "Hand in", text: "See the radiologists' outlines, your score and the time you took.", key: null },
  ];
  return (
    <article className="card bento-card">
      <div className="card-head">
        <h3>A read, start to finish</h3>
      </div>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="step-n">{i + 1}</span>
            <span className="step-text">
              <b>{s.title}</b>
              <span className="muted small">{s.text}</span>
            </span>
            {s.key && <kbd>{s.key}</kbd>}
          </li>
        ))}
      </ol>
    </article>
  );
}

function Controls() {
  const rows: { label: string; keys: { key: string; does: string }[] }[] = [
    { label: "Tools", keys: TOOL_BUTTONS.map((b) => ({ key: b.key.toUpperCase(), does: b.label })) },
    { label: "Window", keys: PRESETS.map((p) => ({ key: p.key, does: p.name })) },
    {
      label: "Scroll",
      keys: [
        { key: "↑", does: "Back" },
        { key: "↓", does: "On" },
        { key: "PgUp", does: "−10" },
        { key: "PgDn", does: "+10" },
      ],
    },
    {
      label: "View",
      keys: [
        { key: "F", does: "Fill" },
        { key: "X", does: "Lines" },
        { key: "R", does: "Reset" },
      ],
    },
  ];
  return (
    <article className="card bento-card">
      <div className="card-head">
        <h3>Controls</h3>
        <span className="tag">Keyboard</span>
      </div>
      <div className="keymap">
        {rows.map((row) => (
          <div className="keymap-row" key={row.label}>
            <span className="keymap-label">{row.label}</span>
            {row.keys.map((k) => (
              <span className="keycap" key={k.key} title={`${k.key}: ${k.does}`}>
                <kbd>{k.key}</kbd>
                <span>{k.does}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="muted small card-note">
        Right-drag sets the window, middle-drag pans, right-click opens the menu. On a touch screen, pick a tool in the
        toolbar and drag.
      </p>
    </article>
  );
}

function Colours() {
  const rgb = (c: [number, number, number]) => `rgb(${c.join(" ")})`;
  const rows = [
    { colour: LESION_COLOURS.mark, name: "Your measurements", text: "The lines you draw", tag: "You", line: true },
    { colour: LESION_COLOURS.tumour, name: "Tumour", text: "Outlined by radiologists", tag: "Reference" },
    { colour: LESION_COLOURS.cyst, name: "Cyst", text: "Where the dataset outlines them", tag: "Reference" },
    { colour: rgb(CLASS_COLOURS.kidney), name: "Kidney", text: "Outlined by radiologists", tag: "Reference" },
    { colour: AI_COLOUR, name: "AI second reader", text: "Dotted, on cases with an AI read", tag: "AI", dotted: true },
  ];
  return (
    <article className="card bento-card">
      <div className="card-head">
        <h3>Colours at hand-in</h3>
      </div>
      <ul className="legend">
        {rows.map((r) => (
          <li key={r.name}>
            <span
              className={`legend-mark${r.line ? " line" : ""}${r.dotted ? " dotted" : ""}`}
              style={{ color: r.colour }}
              aria-hidden="true"
            />
            <span className="legend-text">
              <b>{r.name}</b>
              <span className="muted small">{r.text}</span>
            </span>
            <span className={`chip${r.tag === "AI" ? " chip-ai" : ""}`}>{r.tag}</span>
          </li>
        ))}
      </ul>
      <p className="muted small card-note">The answers and the AI's read stay hidden until you hand in.</p>
    </article>
  );
}

function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}
