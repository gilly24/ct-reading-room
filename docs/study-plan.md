# Study plan (draft)

A draft protocol to take to a supervisor, and through them to a human research
ethics committee. Nothing here runs without their approval. The supervisor and
the committee decide the final design; this page is a starting point.

## Question

When learners read abdominal CT for kidney masses with an AI second reader,
does seeing the AI's read **before** their own, rather than **after** it,
change:

1. how many masses they find, and how many false ones they report;
2. how far their measurements are from the reference;
3. how often they follow the AI when it is wrong?

The evidence on AI timing comes mostly from experienced radiologists reading
mammograms (related-work.md). Little is known for learners, for CT, or for
measurements.

## Design

- **Crossover, within participants.** Each participant reads two blocks of
  cases: one with the AI shown first, one with the AI shown after their own
  hand-in, when they may revise. Block order and case-to-block assignment are
  randomised and balanced.
- **Real AI output only.** The AI's reads are the trained model's own, on cases
  it never trained on. The case set is chosen to include some of its real
  misses and false positives. No made-up AI output (AGENTS.md).
- **Cases.** About 12–16, all held out from the model, including cases without
  a kidney mass. KiTS cases all have one, so tumour-free cases need another
  public source, chosen with the supervisor and checked by a radiologist.
- **Participants.** Medical, radiography or junior medical learners. About
  20–30 is a pilot-sized study; the supervisor, or a statistician, sets the
  number.
- **Session.** About 45–60 minutes in the browser: a short tutorial on the
  phantom, then the two blocks.

## Measures

Per case and participant: masses found, false positives, long-axis error
against the reference (mm), time to hand-in, agreement with the AI, answers
changed after seeing the AI, and confidence (1–5). A short questionnaire at
the end on trust in the AI.

## Analysis

Paired comparisons of AI-first against AI-after, by mixed-effects models with
participant and case as random effects (to be confirmed with the supervisor).
Reported with confidence intervals, not only p-values. A pilot this size gives
effect sizes for a larger study rather than a final answer.

## Data and the site

- A **study mode**, reached only by a link with a participant code, separate
  from the public site. The public site keeps recording nothing.
- A consent screen first. No names, emails or health information: only the
  participant code and the reads (marks, answers, times).
- Stored in the project's own Cloudflare storage, readable only by the
  researchers, deleted on request and at the end of the retention period the
  committee sets.
- No scans are uploaded or collected. The cases are the same public ones.

## Ethics and timing

Likely a low-risk application through the university's human research ethics
process. Committees often meet less over December and January, so ask the
supervisor about meeting dates and apply in week 1 (roadmap.md). The study
mode can be built and piloted with the research team while the application is
reviewed; no participant data is collected before approval.

## Questions for the supervisor

1. Which committee, which application form, and how long does review take?
2. Who are suitable participants, and how are they invited without pressure
   (for example, not by their own teacher)?
3. Which source for cases without a kidney mass, and which radiologist checks them?
4. The sample size, and whether a power calculation is needed for a pilot.
5. Where the data may be stored, and for how long.
6. Authorship and where the results could be presented.
