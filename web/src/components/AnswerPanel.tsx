import type { AiFindings, CaseMeta, Lesion, Truth } from "../case/types";
import { AI_MARK_PREFIX } from "../read/ai";
import type { Mark } from "../read/marks";
import type { LesionResult, Score } from "../read/scoring";
import { REPO_URL } from "../site";
import { clock } from "./format";

type Props = {
  meta: CaseMeta;
  truth: Truth | null;
  error: string | null;
  score: Score | null;
  marks: Mark[];
  elapsed: number;
  referenceReport: string;
  showOutlines: boolean;
  showReference: boolean;
  onShowOutlines(v: boolean): void;
  onShowReference(v: boolean): void;
  onGo(slice: number): void;
  onRestart(): void;
  nextCaseId: string | null;
  ai: AiFindings | null;
  aiError: string | null;
  aiScore: Score | null;
  aiReport: string;
  showAi: boolean;
  onShowAi(v: boolean): void;
};

export function AnswerPanel(props: Props) {
  const { meta, truth, error, score, marks, elapsed } = props;
  if (error) return <section className="panel-section">The answers would not load: {error}</section>;
  if (!truth || !score) return <section className="panel-section muted">Loading the answers…</section>;

  const number = (id: string) => marks.findIndex((m) => m.id === id) + 1;
  const missed = score.tumours.filter((t) => !t.markId || t.markKind === "cyst");

  return (
    <>
      <section className="panel-section answer">
        <h2>How you did</h2>
        <div className="stats">
          <Stat label="Tumours found" value={`${score.found} of ${score.total}`} tone={score.found === score.total ? "good" : "bad"} />
          <Stat
            label="False positives"
            value={String(score.falsePositives.length)}
            tone={score.falsePositives.length === 0 ? "good" : "bad"}
          />
          <Stat label="Size error" value={score.meanAbsErrorMm === null ? "–" : `${score.meanAbsErrorMm} mm`} />
          <Stat label="Time" value={clock(elapsed)} />
        </div>
        {missed.length === 0 && score.falsePositives.length === 0 && (
          <p className="good-text">Every tumour found, and nothing extra.</p>
        )}
      </section>

      <section className="panel-section">
        <h2>The reference</h2>
        <p className="muted small">{truth.note}</p>
        <ul className="lesions">
          {score.tumours.map((t) => (
            <LesionRow key={t.lesion.id} result={t} number={number} onGo={props.onGo} total={meta.geometry.slices} />
          ))}
          {truth.lesions
            .filter((l) => l.kind === "cyst")
            .map((l) => (
              <LesionRow
                key={l.id}
                result={score.cysts.find((c) => c.lesion.id === l.id) ?? emptyResult(l)}
                number={number}
                onGo={props.onGo}
                total={meta.geometry.slices}
              />
            ))}
        </ul>
        {score.falsePositives.length > 0 && (
          <p className="small">
            Measurements on no outlined lesion: {score.falsePositives.map((id) => `#${number(id)}`).join(", ")}.
            {truth.lesions.every((l) => l.kind !== "cyst") &&
              " Cysts were not outlined in this dataset, so a cyst you measured counts here too."}
          </p>
        )}
        {score.duplicates.length > 0 && (
          <p className="small muted">
            Measured twice: {score.duplicates.map((id) => `#${number(id)}`).join(", ")} (not counted against you).
          </p>
        )}
        <div className="toggles">
          <label>
            <input type="checkbox" checked={props.showOutlines} onChange={(e) => props.onShowOutlines(e.target.checked)} />{" "}
            Outlines
          </label>
          <label>
            <input
              type="checkbox"
              checked={props.showReference}
              onChange={(e) => props.onShowReference(e.target.checked)}
            />{" "}
            Reference measurements
          </label>
        </div>
      </section>

      {meta.ai && <AiSection {...props} />}

      <section className="panel-section">
        <details>
          <summary>Report drafted from the reference</summary>
          <pre className="report">{props.referenceReport}</pre>
        </details>
      </section>

      <section className="panel-section buttons">
        <button onClick={props.onRestart}>Read it again</button>
        {props.nextCaseId ? (
          <a className="button primary" href={`#/case/${props.nextCaseId}`}>
            Next case
          </a>
        ) : (
          <a className="button" href="#/">
            All cases
          </a>
        )}
      </section>
    </>
  );
}

/** The AI's read, scored against the reference by the same rules as the reader's. A second reader, never an answer. */
function AiSection({ meta, ai, aiError, aiScore, score, aiReport, showAi, onShowAi, onGo }: Props) {
  if (aiError) {
    return <section className="panel-section">The AI's read would not load: {aiError}</section>;
  }
  if (!ai || !aiScore || !score) {
    return <section className="panel-section muted">Loading the AI's read…</section>;
  }
  const total = meta.geometry.slices;
  const missed = aiScore.tumours.filter((t) => !t.markId);
  const verdictFor = (lesion: Lesion): { text: string; tone: "good" | "bad" | "" } => {
    const id = `${AI_MARK_PREFIX}${lesion.id}`;
    const matched = [...aiScore.tumours, ...aiScore.cysts].find((t) => t.markId === id);
    if (matched) {
      const error = matched.errorMm ?? 0;
      const kindMatches = matched.lesion.kind === lesion.kind;
      return {
        text: kindMatches
          ? `On ${matched.lesion.id}: ${lesion.longAxisMm.toFixed(0)} mm against ${matched.lesion.longAxisMm.toFixed(0)} mm (${error > 0 ? "+" : ""}${error} mm)`
          : `On ${matched.lesion.id}, a ${matched.lesion.kind}, but called a ${lesion.kind}`,
        tone: kindMatches ? "good" : "bad",
      };
    }
    if (aiScore.duplicates.includes(id)) return { text: "A second outline on a tumour already matched", tone: "" };
    return { text: "On no outlined lesion", tone: "bad" };
  };

  return (
    <section className="panel-section ai-read">
      <h2>The AI second reader</h2>
      <div className="stats">
        <Stat
          label="Tumours the AI found"
          value={`${aiScore.found} of ${aiScore.total}`}
          tone={aiScore.found === aiScore.total ? "good" : "bad"}
        />
        <Stat
          label="AI false positives"
          value={String(aiScore.falsePositives.length)}
          tone={aiScore.falsePositives.length === 0 ? "good" : "bad"}
        />
        <Stat label="AI size error" value={aiScore.meanAbsErrorMm === null ? "–" : `${aiScore.meanAbsErrorMm} mm`} />
        <Stat label="You found" value={`${score.found} of ${score.total}`} />
      </div>
      <p className="muted small">
        Scored against the reference by the same rules as your read. A second opinion to compare with, not an answer.
      </p>
      {ai.lesions.length === 0 ? (
        <p className="small">The AI outlined no tumour.</p>
      ) : (
        <ul className="lesions">
          {ai.lesions.map((lesion) => {
            const verdict = verdictFor(lesion);
            return (
              <li key={lesion.id} className="lesion ai">
                <button className="link" onClick={() => onGo(lesion.keySlice)}>
                  AI {lesion.id} · {lesion.kind === "tumour" ? "Tumour" : "Cyst"}, {where(lesion) || "unknown organ"}
                </button>
                <div className="small">
                  {lesion.longAxisMm.toFixed(0)} × {lesion.shortAxisMm.toFixed(0)} mm · {lesion.volumeCm3.toFixed(1)} cm³ · Im{" "}
                  {lesion.keySlice + 1}/{total}
                </div>
                <div className={`small verdict ${verdict.tone}`}>{verdict.text}</div>
              </li>
            );
          })}
        </ul>
      )}
      {missed.length > 0 && (
        <p className="small verdict bad">Missed by the AI: {missed.map((t) => t.lesion.id).join(", ")}.</p>
      )}
      <div className="toggles">
        <label>
          <input type="checkbox" checked={showAi} onChange={(e) => onShowAi(e.target.checked)} /> AI outlines and
          measurements
        </label>
      </div>
      <details>
        <summary>Report drafted from the AI's outlines</summary>
        <pre className="report">{aiReport}</pre>
      </details>
      <p className="muted small model-note">
        {ai.note}{" "}
        {ai.model.card && (
          <a href={`${REPO_URL}/blob/main/${ai.model.card}`} target="_blank" rel="noopener noreferrer">
            Model card
          </a>
        )}
      </p>
    </section>
  );
}

function where(lesion: Lesion): string {
  return [lesion.side && lesion.organ === "kidney" ? `${lesion.side} kidney` : lesion.organ, lesion.pole && `${lesion.pole} pole`]
    .filter(Boolean)
    .join(", ")
    .replace("interpolar pole", "interpolar");
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function LesionRow({
  result,
  number,
  onGo,
  total,
}: {
  result: LesionResult;
  number(id: string): number;
  onGo(slice: number): void;
  total: number;
}) {
  const { lesion } = result;
  let verdict: string;
  if (!result.markId) {
    verdict = lesion.kind === "tumour" ? "Missed" : "Not measured";
  } else if (lesion.kind === "tumour" && result.markKind === "cyst") {
    verdict = `Measured as #${number(result.markId)}, but called a cyst`;
  } else if (lesion.kind === "cyst" && result.markKind === "tumour") {
    verdict = `Measured as #${number(result.markId)} and called a mass: it is a cyst`;
  } else {
    const error = result.errorMm ?? 0;
    verdict = `Your #${number(result.markId)}: ${result.markMm} mm (${error > 0 ? "+" : ""}${error} mm)`;
  }
  const tone = !result.markId ? (lesion.kind === "tumour" ? "bad" : "") : result.markKind === "cyst" || (lesion.kind === "cyst" && result.markKind === "tumour") ? "bad" : "good";
  return (
    <li className={`lesion ${lesion.kind}`}>
      <button className="link" onClick={() => onGo(lesion.keySlice)}>
        {lesion.id} · {lesion.kind === "tumour" ? "Tumour" : "Cyst"}, {where(lesion) || "unknown organ"}
      </button>
      <div className="small">
        {lesion.longAxisMm.toFixed(0)} × {lesion.shortAxisMm.toFixed(0)} mm · {lesion.volumeCm3.toFixed(1)} cm³ ·{" "}
        {lesion.meanHu} HU · Im {lesion.keySlice + 1}/{total}
      </div>
      <div className={`small verdict ${tone}`}>{verdict}</div>
    </li>
  );
}

function emptyResult(lesion: Lesion): LesionResult {
  return { lesion, markId: null, markKind: null, markMm: null, errorMm: null };
}
