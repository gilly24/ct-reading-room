# Safety

The rules this project keeps, and why. They are what make it a teaching demo
rather than something a regulator, an ethics committee or an employer would
have to worry about.

## It is not a medical device

Software that looks at a patient's scan and says what is in it is regulated as
a medical device almost everywhere (the TGA in Australia, the FDA in the US).
This site is not one and must not behave like one:

- It shows a fixed set of public cases. **It never accepts a scan from a
  visitor.** An upload feature would make it a diagnostic service and put
  health data on our hands.
- Every page says it is an educational demo, not for clinical use.
- The AI (milestone 2) is shown as a second reader to compare against, never
  as an answer.

## Only public, de-identified data

- Never a scan from a hospital, clinic or colleague, however anonymised it
  looks. Names and IDs hide in DICOM headers and in text burned into the image.
- The legitimate way to use real clinical data is a research study run by the
  institution, with ethics approval, where the data never leaves it. That is a
  different project with different people in charge.
- Only datasets whose licence allows re-hosting, credited wherever they are
  shown (data.md).

## The learner study

The study (study-plan.md) runs only with a supervisor and ethics approval, in a
separate study mode reached by a participant link, after consent. It records a
participant code and their reads, never names, contact details or health
information, and never a scan. The public site records nothing. The AI's reads
in the study are the real model's, on cases it never trained on.

## The drafter does not diagnose

The report draft states what was measured: organ, side, size, image number.
The impression is always left to the person. When a language model writes
prose (milestone 3), it receives only the measured findings, and a check
refuses any draft with a number, side or organ the findings do not contain.

## Whose project it is

It is a personal project, built on public data, in its author's own name and
design. Nothing in it belongs to, or speaks for, an employer.
