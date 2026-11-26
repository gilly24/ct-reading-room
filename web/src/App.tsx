import { useCallback, useEffect, useState } from "react";
import type { CaseSummary } from "./case/types";
import { CaseList } from "./components/CaseList";
import { ReadingRoom } from "./components/ReadingRoom";
import { loadIndex } from "./case/load";
import { REPO_URL } from "./site";

function useRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

export function App() {
  const route = useRoute();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const remember = useCallback((list: CaseSummary[]) => setCases(list), []);
  const caseId = route.match(/^\/case\/([a-z0-9-]+)$/)?.[1] ?? null;

  // Opening a case by link still needs the list, to know which case is next.
  useEffect(() => {
    if (caseId && cases.length === 0) loadIndex().then((i) => setCases(i.cases)).catch(() => {});
  }, [caseId, cases.length]);

  const position = caseId ? cases.findIndex((c) => c.id === caseId) : -1;
  const nextCaseId = position >= 0 && position + 1 < cases.length ? cases[position + 1].id : null;

  return (
    <div className="app">
      <header className="site-head">
        <a href="#/" className="brand">
          CT Reading Room
        </a>
        <span className="badge" title="Nothing here may be used to diagnose or treat anyone.">
          <span className="badge-wide">Educational demo · not for clinical use</span>
          <span className="badge-narrow">Not for clinical use</span>
        </span>
        <a className="repo" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          Source
        </a>
      </header>
      <main className="site-main">
        {caseId ? <ReadingRoom key={caseId} caseId={caseId} nextCaseId={nextCaseId} /> : <CaseList onCases={remember} />}
      </main>
    </div>
  );
}
