import type { Draft } from "../read/report";

/** A drafted report, or why the checker refused it. A refused draft is never shown. */
export function DraftView({ draft }: { draft: Draft }) {
  return draft.problems.length === 0 ? <pre className="report">{draft.text}</pre> : <Refused draft={draft} />;
}

export function Refused({ draft }: { draft: Draft }) {
  return (
    <div className="refused" role="alert">
      <p>The checker refused this draft, so it is not shown:</p>
      <ul>
        {draft.problems.map((p, i) => (
          <li key={i}>
            {p.line > 0 ? `Line ${p.line}: ` : ""}
            {p.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
