import { useEffect, useState } from "react";
import { loadIndex } from "../case/load";
import type { CaseSummary } from "../case/types";

export function CaseList({ onCases }: { onCases(cases: CaseSummary[]): void }) {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIndex()
      .then((index) => {
        setCases(index.cases);
        onCases(index.cases);
      })
      .catch((e) => setError(String(e)));
  }, [onCases]);

  return (
    <div className="home">
      <section className="intro">
        <h1>Read abdominal CT like a radiologist.</h1>
        <p>
          Scroll through real scans, find every kidney tumour, measure it and draft the report. Then see the
          radiologists' outlines and how close you were. An AI second reader that does the same is being built
          alongside it.
        </p>
        <ul className="how">
          <li>
            <b>Scroll</b> with the mouse wheel or arrow keys.
          </li>
          <li>
            <b>Window</b> with presets 1–4, or drag with the Window tool.
          </li>
          <li>
            <b>Measure</b> (M) a lesion's longest diameter on the image where it is biggest.
          </li>
          <li>
            <b>Hand in</b> to see the answers and your score.
          </li>
        </ul>
      </section>

      <section>
        <h2>Cases</h2>
        {error && <p className="error">The case list would not load. {error}</p>}
        {!cases && !error && <p className="muted">Loading…</p>}
        {cases && cases.length === 0 && (
          <p className="muted">
            No cases yet. Build some with the pipeline: <code>ctrr phantom</code> (docs/getting-started.md).
          </p>
        )}
        <ul className="cases">
          {cases?.map((c) => (
            <li key={c.id}>
              <a href={`#/case/${c.id}`} className="case-card">
                <span className="case-title">{c.title}</span>
                <span className="muted small">{c.description}</span>
                <span className="muted small">
                  {c.slices} images · {c.dataset}
                  {c.hasAi ? " · AI read available" : ""}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="credits muted small">
        <h2>Where the scans come from</h2>
        <p>
          The kidney cases are from C4KC-KiTS (Heller N, Sathianathen N, Kalapara A, et al., The Cancer Imaging Archive,
          2019, <a href="https://doi.org/10.7937/TCIA.2019.IX49E8NX">doi:10.7937/TCIA.2019.IX49E8NX</a>), licensed CC BY
          3.0, served by the{" "}
          <a href="https://portal.imaging.datacommons.cancer.gov/collections/c4kc_kits">NCI Imaging Data Commons</a>. They
          are de-identified public research scans. The tutorial case is synthetic: nobody's scan.
        </p>
      </section>
    </div>
  );
}
