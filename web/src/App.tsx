import { useCallback, useEffect, useState } from "react";
import type { CaseSummary } from "./case/types";
import { HOME_SECTIONS, Home, scrollToSection } from "./components/Home";
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
          <img src="/favicon.svg" alt="" width="20" height="20" />
          CT Reading Room
        </a>
        <span className="badge" title="Nothing here may be used to diagnose or treat anyone.">
          <span className="badge-wide">Educational demo · not for clinical use</span>
          <span className="badge-narrow">Not for clinical use</span>
        </span>
        {!caseId && (
          <nav className="site-nav" aria-label="On this page">
            {HOME_SECTIONS.map((s) => (
              <button type="button" key={s.id} onClick={() => scrollToSection(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
        )}
        <a className="repo" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="Source code on GitHub">
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
          <span className="repo-text">Source</span>
        </a>
      </header>
      <main className="site-main">
        {caseId ? <ReadingRoom key={caseId} caseId={caseId} nextCaseId={nextCaseId} /> : <Home onCases={remember} />}
      </main>
    </div>
  );
}
