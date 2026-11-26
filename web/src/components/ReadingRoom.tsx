import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { citationParts, licenceUrl } from "../case/credit";
import { type LabelVolume, NotFound, loadAi, loadCase, loadLabels, loadTruth } from "../case/load";
import type { AiFindings, CaseMeta, Lesion, Truth } from "../case/types";
import { marksFromLesions } from "../read/ai";
import type { Mark, MarkKind } from "../read/marks";
import { READER, aiSource, draftReport, itemFromLesion, itemFromMark, referenceSource } from "../read/report";
import { scoreRead } from "../read/scoring";
import type { ToolChoice } from "../viewer/cornerstone";
import { type ViewName, VIEWS } from "../viewer/mpr";
import { REPO_URL } from "../site";
import { PRESETS } from "../viewer/presets";
import { type Layout, type MarkGeometry, Viewer, type ViewerHandle, VIEW_TITLES } from "../viewer/Viewer";
import { AnswerPanel } from "./AnswerPanel";
import { Refused } from "./DraftView";
import { clock } from "./format";
import { Icon, type IconName } from "./Icon";
import { Menu, type MenuEntry } from "./Menu";

type Phase = "reading" | "reviewing";
type MarkChoice = { kind: MarkKind; organ: string };

/** What the left mouse button does. The right button always sets the window, the middle button pans. */
export const TOOL_BUTTONS: { tool: ToolChoice; label: string; key: string; hint: string }[] = [
  { tool: "scroll", label: "Scroll", key: "s", hint: "Drag up and down to move through the images (or use the wheel)" },
  { tool: "window", label: "Window", key: "w", hint: "Drag to change brightness and contrast (or right-drag)" },
  { tool: "pan", label: "Pan", key: "p", hint: "Drag to move the image (or middle-drag, or Shift-drag)" },
  { tool: "zoom", label: "Zoom", key: "z", hint: "Drag to zoom (or Ctrl-drag, or Ctrl and the wheel)" },
  { tool: "measure", label: "Measure", key: "m", hint: "Drag across a lesion's longest diameter, on an axial image" },
];

/** Below this width the three views do not fit: one at a time, with a switch. */
const NARROW = "(max-width: 640px)";

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function ReadingRoom({ caseId, nextCaseId }: { caseId: string; nextCaseId: string | null }) {
  const [meta, setMeta] = useState<CaseMeta | null>(null);
  const [error, setError] = useState<"missing" | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setMeta(null);
    setError(null);
    loadCase(caseId)
      .then((m) => live && setMeta(m))
      .catch((e) => {
        if (!live) return;
        if (!(e instanceof NotFound)) console.error(e);
        setError(e instanceof NotFound ? "missing" : "failed");
      });
    return () => {
      live = false;
    };
  }, [caseId]);

  if (error)
    return (
      <div className="page-message">
        <p>
          {error === "missing"
            ? `There is no case called “${caseId}”.`
            : "This case could not be opened. Check your connection, then reload the page."}
        </p>
        <p>
          <a href="#/">Back to the cases</a>
        </p>
      </div>
    );
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
  const [tool, setTool] = useState<ToolChoice>("scroll");
  const [phase, setPhase] = useState<Phase>("reading");
  const [geometry, setGeometry] = useState<MarkGeometry[]>([]);
  const [choices, setChoices] = useState<Record<string, MarkChoice>>({});
  const [chosenLayout, setLayout] = useState<Layout>("three");
  const [focus, setFocus] = useState<ViewName>("axial");
  const [showLines, setShowLines] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: "all" | "presets" } | null>(null);
  const narrow = useMedia(NARROW);
  const layout: Layout = narrow ? "single" : chosenLayout;
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
  const [ai, setAi] = useState<AiFindings | null>(null);
  const [aiLabels, setAiLabels] = useState<LabelVolume | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showAi, setShowAi] = useState(true);

  const defaultOrgan = "kidney";
  const marks: Mark[] = useMemo(
    () => geometry.map((g) => ({ ...g, kind: choices[g.id]?.kind ?? "tumour" })),
    [geometry, choices],
  );
  const organOf = useCallback((id: string) => choices[id]?.organ ?? defaultOrgan, [choices, defaultOrgan]);

  const draft = useMemo(
    () => draftReport(meta, marks.map((m) => itemFromMark(m, organOf(m.id))), READER),
    [meta, marks, organOf],
  );
  useEffect(() => {
    if (!reportEdited) setReport(draft.problems.length === 0 ? draft.text : "");
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
    setTool("scroll");
    // The AI's read loads beside the answers, never before: it must not steer the reader's own.
    const aiRead = meta.ai
      ? loadAi(meta)
          .then(async (found) => {
            setAi(found);
            if (found) setAiLabels(await loadLabels(meta, found));
          })
          .catch((e) => setAiError(String(e)))
      : Promise.resolve();
    try {
      const t = await loadTruth(meta);
      setTruth(t);
      setLabels(await loadLabels(meta, t));
    } catch (e) {
      setTruthError(String(e));
    }
    await aiRead;
  };

  const changeLayout = useCallback((next: Layout, view: ViewName) => {
    setLayout(next);
    setFocus(view);
  }, []);
  const toggleLayout = useCallback(
    (view: ViewName) => {
      // On a phone there is only room for one view, so this switches which one.
      if (narrow) return setFocus(view === focus ? "axial" : view);
      changeLayout(layout === "three" ? "single" : "three", view);
    },
    [narrow, focus, layout, changeLayout],
  );
  const closeMenu = useCallback(() => setMenu(null), []);

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
      const key = e.key.toLowerCase();
      const button = TOOL_BUTTONS.find((b) => b.key === key);
      if (button && (button.tool !== "measure" || phase === "reading")) setTool(button.tool);
      if (key === "r") viewer.current?.reset();
      if (key === "x") setShowLines((on) => !on);
      if (key === "f") toggleLayout(viewer.current?.activeView() ?? "axial");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, toggleLayout]);

  const score = useMemo(
    () => (truth ? scoreRead(marks, truth.lesions, { pixelSpacingMm: meta.geometry.pixelSpacingMm }) : null),
    [truth, marks, meta],
  );
  const referenceReport = useMemo(
    () => (truth ? draftReport(meta, truth.lesions.map(itemFromLesion), referenceSource(truth)) : null),
    [truth, meta],
  );
  // The AI is scored against the reference exactly as the reader is.
  const aiScore = useMemo(
    () =>
      truth && ai
        ? scoreRead(marksFromLesions(ai.lesions), truth.lesions, { pixelSpacingMm: meta.geometry.pixelSpacingMm })
        : null,
    [truth, ai, meta],
  );
  const aiReport = useMemo(
    () => (ai ? draftReport(meta, ai.lesions.map(itemFromLesion), aiSource(ai)) : null),
    [ai, meta],
  );

  const elapsed = startedAt ? Math.max(0, Math.round(((finishedAt ?? now) - startedAt) / 1000)) : 0;
  const presetEntries: MenuEntry[] = PRESETS.map((p) => ({
    kind: "item",
    label: `${p.name}  ·  W ${p.width} L ${p.center}`,
    shortcut: p.key,
    onSelect: () => viewer.current?.setWindow(p.width, p.center),
  }));
  const menuEntries: MenuEntry[] = [
    { kind: "heading", label: "Left button" },
    ...TOOL_BUTTONS.map((b): MenuEntry => ({
      kind: "item",
      label: b.label,
      shortcut: b.key.toUpperCase(),
      role: "radio",
      checked: tool === b.tool,
      disabled: b.tool === "measure" && phase !== "reading",
      onSelect: () => setTool(b.tool),
    })),
    { kind: "divider" },
    { kind: "heading", label: "Window" },
    ...presetEntries,
    { kind: "divider" },
    {
      kind: "item",
      label: "Crosshair lines",
      shortcut: "X",
      role: "checkbox",
      checked: showLines,
      onSelect: () => setShowLines((on) => !on),
    },
    {
      kind: "item",
      label: narrow ? "Next view" : layout === "three" ? "One view" : "Three views",
      shortcut: "F",
      onSelect: () => toggleLayout(viewer.current?.activeView() ?? "axial"),
    },
    { kind: "item", label: "Reset", shortcut: "R", onSelect: () => viewer.current?.reset() },
  ];
  const reference: Lesion[] | null = phase === "reviewing" && truth && showReference ? truth.lesions : null;

  return (
    <div className="room">
      <section className="room-main">
        <div className="toolbar" role="toolbar" aria-label="Viewer tools">
          {TOOL_BUTTONS.map((b) => (
            <ToolButton
              key={b.tool}
              icon={b.tool}
              label={b.label}
              active={tool === b.tool}
              onClick={() => setTool(b.tool)}
              disabled={b.tool === "measure" && phase !== "reading"}
              title={`${b.hint} (${b.key.toUpperCase()})`}
            />
          ))}
          <span className="divider" />
          <ToolButton
            icon="presets"
            label="Presets"
            anchor
            expanded={menu?.entries === "presets"}
            onClick={(e) => {
              if (menu?.entries === "presets") return setMenu(null);
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 2, entries: "presets" });
            }}
            title="Window presets (1–4)"
          />
          <ToolButton
            icon="lines"
            label="Crosshair"
            short="Lines"
            active={showLines}
            onClick={() => setShowLines((on) => !on)}
            title="Show where the other views cut this one; drag a line to move that view (X)"
          />
          {!narrow && (
            <ToolButton
              icon={layout === "three" ? "single" : "three"}
              label={layout === "three" ? "1 view" : "3 views"}
              onClick={() => toggleLayout(viewer.current?.activeView() ?? "axial")}
              title="One view or three (F, or double-click a view)"
            />
          )}
          <ToolButton icon="reset" label="Reset" onClick={() => viewer.current?.reset()} title="Reset zoom, pan and window (R)" />
          {layout === "single" && (
            <div className="view-switch" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button key={v} className={focus === v ? "active" : ""} onClick={() => setFocus(v)}>
                  {VIEW_TITLES[v]}
                </button>
              ))}
            </div>
          )}
        </div>
        <Viewer
          ref={viewer}
          meta={meta}
          tool={tool}
          canMeasure={phase === "reading"}
          reference={reference}
          labels={phase === "reviewing" ? labels : null}
          showOutlines={showOutlines}
          ai={phase === "reviewing" && showAi && ai ? ai.lesions : null}
          aiLabels={phase === "reviewing" && showAi ? aiLabels : null}
          layout={layout}
          focus={focus}
          showLines={showLines}
          onLayout={(next, view) => (narrow ? setFocus(view) : changeLayout(next, view))}
          onMenu={(x, y) => setMenu({ x, y, entries: "all" })}
          onMarks={setGeometry}
          onReady={onReady}
        />
        {menu && (
          <Menu
            x={menu.x}
            y={menu.y}
            label={menu.entries === "presets" ? "Window presets" : "Viewer"}
            entries={menu.entries === "presets" ? presetEntries : menuEntries}
            onClose={closeMenu}
          />
        )}
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
              Drag up and down, or use the wheel, to scroll through every image; right-drag sets the window. The
              coronal and sagittal views show the same scan from the front and the side: drag a crosshair line to move
              through them. Use <b>Measure</b> on the axial images to draw each lesion's longest diameter, then say
              what you think it is. Hand in when you have reported everything you see.
            </p>
            {!ready && <p className="muted small">Images are loading…</p>}
          </section>
        )}

        <section className="panel-section">
          <h2>Measurements {marks.length > 0 && <span className="count">{marks.length}</span>}</h2>
          {marks.length === 0 ? (
            <p className="muted small">
              {phase === "reading"
                ? "None yet. Choose Measure (M) and drag across a lesion."
                : "None. You handed in without measuring anything."}
            </p>
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
          {!reportEdited && draft.problems.length > 0 && <Refused draft={draft} />}
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
            ai={ai}
            aiError={aiError}
            aiScore={aiScore}
            aiReport={aiReport}
            showAi={showAi}
            onShowAi={setShowAi}
            onGo={(s) => viewer.current?.goToSlice(s)}
            onRestart={onRestart}
            nextCaseId={nextCaseId}
          />
        )}

        {!(meta.ai && phase === "reviewing") && (
          <section className="panel-section">
            <h2>AI second reader</h2>
            <p className="muted small">
              {meta.ai ? (
                "An AI has read this case too. Its findings appear beside the answers when you hand in, so they cannot steer your read."
              ) : (
                <>
                  Not run on this case yet. The model that will find and measure tumours is being trained (
                  <a href={`${REPO_URL}/blob/main/docs/roadmap.md`} target="_blank" rel="noopener noreferrer">
                    roadmap
                  </a>
                  ).
                </>
              )}
            </p>
          </section>
        )}

        <footer className="panel-foot muted small">
          <p>
            Images: {meta.source.dataset}
            {meta.source.patient ? ` (${meta.source.patient})` : ""}, licence <Licence name={meta.source.licence} />.{" "}
            {meta.source.url ? (
              <a href={meta.source.url} target="_blank" rel="noopener noreferrer">
                Source
              </a>
            ) : null}
          </p>
          <p>
            {citationParts(meta.source.citation).map((part, i) =>
              part.href ? (
                <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
                  {part.text}
                </a>
              ) : (
                part.text
              ),
            )}
          </p>
        </footer>
      </aside>
    </div>
  );
}

function Licence({ name }: { name: string }) {
  const href = licenceUrl(name);
  if (!href) return <>{name}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {name}
    </a>
  );
}

function patientWords(meta: CaseMeta): string {
  const { age, sex } = meta.patient;
  if (!age && !sex) return "";
  const who = sex === "M" ? "man" : sex === "F" ? "woman" : "patient";
  return age ? ` · ${age}-year-old ${who}` : ` · ${who}`;
}

function ToolButton({
  icon,
  label,
  short,
  title,
  active,
  disabled,
  anchor,
  expanded,
  onClick,
}: {
  icon: IconName;
  label: string;
  /** A shorter label for phones. */
  short?: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  /** Opens a menu: the menu leaves clicks on it alone. */
  anchor?: boolean;
  expanded?: boolean;
  onClick(e: React.MouseEvent<HTMLButtonElement>): void;
}) {
  return (
    <button
      className={`tool${active ? " active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active === undefined ? undefined : active}
      aria-haspopup={anchor ? "menu" : undefined}
      aria-expanded={anchor ? Boolean(expanded) : undefined}
      data-menu-anchor={anchor ? "" : undefined}
    >
      <Icon name={icon} />
      <span className="tool-label">
        {short ? (
          <>
            <span className="label-long">{label}</span>
            <span className="label-short">{short}</span>
          </>
        ) : (
          label
        )}
      </span>
    </button>
  );
}
