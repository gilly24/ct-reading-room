import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LabelVolume, loadCase, loadLabels, loadTruth } from "../case/load";
import type { CaseMeta, Lesion, Truth } from "../case/types";
import type { Mark, MarkKind } from "../read/marks";
import { draftReport, itemFromLesion, itemFromMark } from "../read/report";
import { scoreRead } from "../read/scoring";
import type { ToolChoice } from "../viewer/cornerstone";
import { PRESETS } from "../viewer/presets";
import { type MarkGeometry, Viewer, type ViewerHandle } from "../viewer/Viewer";
import { AnswerPanel } from "./AnswerPanel";
import { clock } from "./format";

type Phase = "reading" | "reviewing";
type MarkChoice = { kind: MarkKind; organ: string };

const TOOL_BUTTONS: { tool: ToolChoice; label: string; key: string; hint: string }[] = [
  { tool: "window", label: "Window", key: "w", hint: "Drag to change brightness and contrast" },
  { tool: "pan", label: "Pan", key: "p", hint: "Drag to move (or middle-drag)" },
  { tool: "zoom", label: "Zoom", key: "z", hint: "Drag to zoom (or right-drag)" },
  { tool: "measure", label: "Measure", key: "m", hint: "Drag across a lesion's longest diameter" },
];

export function ReadingRoom({ caseId, nextCaseId }: { caseId: string; nextCaseId: string | null }) {
  const [meta, setMeta] = useState<CaseMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setMeta(null);
    setError(null);
    loadCase(caseId)
      .then((m) => live && setMeta(m))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [caseId]);

  if (error) return <div className="page-message">This case could not be opened. {error}</div>;
  if (!meta) return <div className="page-message">Opening case…</div>;
  // A new attempt remounts everything, which clears the viewer's measurements too.
  return (
    <Read
      key={`${meta.id}-${attempt}`}
      meta={meta}
      nextCaseId={nextCaseId}
      onRestart={() => setAttempt((n) => n + 1)}
    />
  );
}

function Read({ meta, nextCaseId, onRestart }: { meta: CaseMeta; nextCaseId: string | null; onRestart(): void }) {
  const viewer = useRef<ViewerHandle>(null);
  const [tool, setTool] = useState<ToolChoice>("window");
  const [phase, setPhase] = useState<Phase>("reading");
  const [geometry, setGeometry] = useState<MarkGeometry[]>([]);
  const [choices, setChoices] = useState<Record<string, MarkChoice>>({});
  const [slice, setSlice] = useState(0);
  const [ready, setReady] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [report, setReport] = useState("");
  const [reportEdited, setReportEdited] = useState(false);
  const [truth, setTruth] = useState<Truth | null>(null);
  const [labels, setLabels] = useState<LabelVolume | null>(null);
  const [truthError, setTruthError] = useState<string | null>(null);
  const [showOutlines, setShowOutlines] = useState(true);
  const [showReference, setShowReference] = useState(true);

  const defaultOrgan = "kidney";
  const marks: Mark[] = useMemo(
    () => geometry.map((g) => ({ ...g, kind: choices[g.id]?.kind ?? "tumour" })),
    [geometry, choices],
  );
  const organOf = useCallback((id: string) => choices[id]?.organ ?? defaultOrgan, [choices, defaultOrgan]);

  const draft = useMemo(
    () => draftReport(meta, marks.map((m) => itemFromMark(m, organOf(m.id))), "your measurements"),
    [meta, marks, organOf],
  );
  useEffect(() => {
    if (!reportEdited) setReport(draft);
  }, [draft, reportEdited]);

  useEffect(() => {
    if (!startedAt || finishedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, finishedAt]);

  const onReady = useCallback(() => {
    const t = Date.now();
    setReady(true);
    setStartedAt(t);
    setNow(t);
  }, []);

  const handIn = async () => {
    setFinishedAt(Date.now());
    setPhase("reviewing");
    setTool("window");
    try {
      const t = await loadTruth(meta);
      setTruth(t);
      setLabels(await loadLabels(meta, t));
    } catch (e) {
      setTruthError(String(e));
    }
  };

  // Keyboard, as on a workstation. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[e.key];
      if (step !== undefined) {
        viewer.current?.step(step);
        e.preventDefault();
        return;
      }
      const preset = PRESETS.find((p) => p.key === e.key);
      if (preset) {
        viewer.current?.setWindow(preset.width, preset.center);
        return;
      }
      const button = TOOL_BUTTONS.find((b) => b.key === e.key.toLowerCase());
      if (button && (button.tool !== "measure" || phase === "reading")) setTool(button.tool);
      if (e.key.toLowerCase() === "r") viewer.current?.reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const score = useMemo(
    () => (truth ? scoreRead(marks, truth.lesions, { pixelSpacingMm: meta.geometry.pixelSpacingMm }) : null),
    [truth, marks, meta],
  );
  const referenceReport = useMemo(
    () => (truth ? draftReport(meta, truth.lesions.map(itemFromLesion), "the reference outlines") : ""),
    [truth, meta],
  );

  const elapsed = startedAt ? Math.max(0, Math.round(((finishedAt ?? now) - startedAt) / 1000)) : 0;
  const total = meta.geometry.slices;
  const reference: Lesion[] | null = phase === "reviewing" && truth && showReference ? truth.lesions : null;

  return (
    <div className="room">
      <section className="room-main">
        <div className="toolbar" role="toolbar" aria-label="Viewer tools">
          {TOOL_BUTTONS.map((b) => (
            <button
              key={b.tool}
              className={tool === b.tool ? "active" : ""}
              onClick={() => setTool(b.tool)}
              disabled={b.tool === "measure" && phase !== "reading"}
              title={`${b.hint} (${b.key.toUpperCase()})`}
            >
              {b.label}
            </button>
          ))}
          <span className="divider" />
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => viewer.current?.setWindow(p.width, p.center)}
              title={`W ${p.width} L ${p.center} (${p.key})`}
            >
              {p.name}
            </button>
          ))}
          <span className="divider" />
          <button onClick={() => viewer.current?.reset()} title="Reset zoom, pan and window (R)">
            Reset
          </button>
        </div>
        <Viewer
          ref={viewer}
          meta={meta}
          tool={tool}
          canMeasure={phase === "reading"}
          reference={reference}
          labels={phase === "reviewing" ? labels : null}
          showOutlines={showOutlines}
          onMarks={setGeometry}
          onReady={onReady}
          onSlice={setSlice}
        />
        <label className="slice-slider">
          <span>
            Image {slice + 1} of {total}
          </span>
          <input
            type="range"
            min={0}
            max={total - 1}
            value={slice}
            onChange={(e) => viewer.current?.goToSlice(Number(e.target.value))}
            aria-label="Image"
          />
        </label>
      </section>

      <aside className="room-panel">
        <header className="panel-head">
          <h1>{meta.title}</h1>
          <p className="muted">
            {meta.description}
            {patientWords(meta)}
          </p>
          <p className="timer" aria-live="off">
            {phase === "reading" ? "Reading" : "Handed in"} · {clock(elapsed)}
          </p>
        </header>

        {phase === "reading" && (
          <section className="panel-section">
            <h2>Your read</h2>
            <p className="muted small">
              Scroll through every image. Use <b>Measure</b> to draw each lesion's longest diameter, then say what you
              think it is. Hand in when you have reported everything you see.
            </p>
            {!ready && <p className="muted small">Images are loading…</p>}
          </section>
        )}

        <section className="panel-section">
          <h2>Measurements {marks.length > 0 && <span className="count">{marks.length}</span>}</h2>
          {marks.length === 0 ? (
            <p className="muted small">None yet. Choose Measure (M) and drag across a lesion.</p>
          ) : (
            <ol className="marks">
              {marks.map((m, i) => (
                <li key={m.id}>
                  <button className="link" onClick={() => viewer.current?.goToSlice(m.slice)}>
                    #{i + 1} · {m.lengthMm.toFixed(0)} mm · Im {m.slice + 1}
                    {m.side ? ` · ${m.side}` : ""}
                  </button>
                  <select
                    value={m.kind}
                    disabled={phase !== "reading"}
                    onChange={(e) =>
                      setChoices((c) => ({ ...c, [m.id]: { organ: organOf(m.id), kind: e.target.value as MarkKind } }))
                    }
                    aria-label={`What measurement ${i + 1} is`}
                  >
                    <option value="tumour">Mass</option>
                    <option value="cyst">Cyst</option>
                    <option value="unsure">Not sure</option>
                  </select>
                  <select
                    value={organOf(m.id)}
                    disabled={phase !== "reading"}
                    onChange={(e) =>
                      setChoices((c) => ({ ...c, [m.id]: { kind: m.kind, organ: e.target.value } }))
                    }
                    aria-label={`Organ of measurement ${i + 1}`}
                  >
                    <option value="kidney">Kidney</option>
                    <option value="liver">Liver</option>
                    <option value="pancreas">Pancreas</option>
                    <option value="spleen">Spleen</option>
                    <option value="other">Other</option>
                  </select>
                  {phase === "reading" && (
                    <button className="icon" onClick={() => viewer.current?.removeMark(m.id)} aria-label={`Delete measurement ${i + 1}`}>
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel-section">
          <h2>Report</h2>
          <p className="muted small">
            Drafted from your measurements as you go. Edit it freely; the impression is yours to write.
          </p>
          <textarea
            value={report}
            onChange={(e) => {
              setReport(e.target.value);
              setReportEdited(true);
            }}
            rows={12}
            spellCheck
            readOnly={phase !== "reading"}
            aria-label="Report"
          />
          {reportEdited && phase === "reading" && (
            <button className="link small" onClick={() => setReportEdited(false)}>
              Redraft from my measurements
            </button>
          )}
        </section>

        {phase === "reading" ? (
          <section className="panel-section">
            <button className="primary" onClick={handIn} disabled={!ready}>
              Hand in my read
            </button>
          </section>
        ) : (
          <AnswerPanel
            meta={meta}
            truth={truth}
            error={truthError}
            score={score}
            marks={marks}
            elapsed={elapsed}
            referenceReport={referenceReport}
            showOutlines={showOutlines}
            showReference={showReference}
            onShowOutlines={setShowOutlines}
            onShowReference={setShowReference}
            onGo={(s) => viewer.current?.goToSlice(s)}
            onRestart={onRestart}
            nextCaseId={nextCaseId}
          />
        )}

        <section className="panel-section">
          <h2>AI second reader</h2>
          <p className="muted small">
            {meta.ai
              ? "AI findings are available for this case."
              : "Not run on this case yet. The model that will find and measure tumours is the next milestone (docs/roadmap.md)."}
          </p>
        </section>

        <footer className="panel-foot muted small">
          <p>
            Images: {meta.source.dataset}
            {meta.source.patient ? ` (${meta.source.patient})` : ""}, licence {meta.source.licence}.{" "}
            {meta.source.url ? (
              <a href={meta.source.url} target="_blank" rel="noopener noreferrer">
                Source
              </a>
            ) : null}
          </p>
          <p>{meta.source.citation}</p>
        </footer>
      </aside>
    </div>
  );
}

function patientWords(meta: CaseMeta): string {
  const { age, sex } = meta.patient;
  if (!age && !sex) return "";
  const who = sex === "M" ? "man" : sex === "F" ? "woman" : "patient";
  return age ? ` · ${age}-year-old ${who}` : ` · ${who}`;
}
