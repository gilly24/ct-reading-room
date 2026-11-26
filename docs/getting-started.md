# Getting started

Everything you need to work on this from a new machine. Choose one:

- [Codespaces](#codespaces-nothing-to-install) — in the browser, nothing to install
- [Your own computer](#your-own-computer) — Windows, Mac or Linux

## Codespaces (nothing to install)

On the repository page on GitHub: **Code → Codespaces → Create codespace on
main**. The container installs everything (`.devcontainer/devcontainer.json`).
When it finishes:

```bash
cd web && pnpm dev
```

Codespaces offers to open port 5173 in your browser. Real cases need the
download below; the free Codespaces disk holds a few comfortably.

## Your own computer

### 1. Install the tools once

| tool | version | how |
|---|---|---|
| Git | any | https://git-scm.com |
| Node.js | 22 or later | https://nodejs.org (or `nvm install`, which reads `.nvmrc`) |
| pnpm | 10 | `corepack enable` (comes with Node) |
| Python | 3.12 or later | https://python.org, or let uv install it |
| uv | latest | https://docs.astral.sh/uv/getting-started/installation/ |

On Windows, use PowerShell or Windows Terminal; every command below works
there as written.

### 2. Get the code

```bash
git clone https://github.com/gilly24/ct-reading-room.git
cd ct-reading-room
```

### 3. Run the site

```bash
cd web
pnpm install
pnpm dev
```

Open http://localhost:5173. You will see the synthetic tutorial case, which is
committed to the repository.

### 4. Add real scans (optional, about 500 MB)

```bash
cd pipeline
uv sync --extra dev
uv run ctrr fetch-kits --count 5
uv run ctrr build-kits
```

`fetch-kits` downloads kidney-tumour CTs and the radiologists' outlines from the
NCI Imaging Data Commons (no account needed) into `pipeline/.data/raw/`. It
skips studies with more than 300 slices; change that with `--max-slices`.
`build-kits` turns them into cases in `web/public/cases/`. Restart `pnpm dev`
and they appear in the list.

Particular patients: `uv run ctrr fetch-kits --patients KiTS-00002 KiTS-00004`.

## Checks before you push

```bash
cd web && pnpm typecheck && pnpm test && pnpm build
cd pipeline && uv sync --extra dev --extra train && uv run pytest
```

CI runs these too on every push and pull request. The `train` extra brings
SimpleITK, which the NIfTI tests need; without it they skip rather than run.

## Using Claude Code or another AI agent

`AGENTS.md` at the root is written for them (and `CLAUDE.md` points to it). It
has the layout, commands and the rules that are easy to break. Start a session
from the repository root.

## Troubleshooting

**"This case would not load" in `pnpm dev` only.** Delete
`web/node_modules/.vite` and restart; the dev server's pre-bundled copy of the
DICOM libraries is stale. The `optimizeDeps` list in `web/vite.config.ts`
explains what has to stay unbundled.

**The tab runs out of memory on a big case in dev.** Something is passing a
large array as a React prop. See the `LabelVolume` note in `AGENTS.md`.

**`fetch-kits` is slow or stops.** It resumes: run it again and it skips what
it already has (`pipeline/.data/raw/fetched.json`).

**Outlines look shifted.** The case was built from a SEG whose frames are not
on the CT slices; `build-kits` should have refused it. Report the patient ID.
