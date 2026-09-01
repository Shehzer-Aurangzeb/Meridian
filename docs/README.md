# docs — what is here and what it is worth

Reorganised 30 Aug 2026, updated 1 Sept 2026. Nothing has ever been deleted;
`docs/` has almost no git history, so a delete here is unrecoverable and
everything superseded is moved to `archive/` instead.

## Where to start

| you want | read |
|---|---|
| **everything: what runs, what was tested, where it fails** | [`STATE_OF_MERIDIAN_2026-09-01.md`](STATE_OF_MERIDIAN_2026-09-01.md) |
| the individual experiments and their bars | [`evidence/README.md`](evidence/README.md) |
| what is parked, and why | [`ROADMAP.md`](ROADMAP.md) |
| how the app is built | the state document above, then the code |

## The folders

**`active/` no longer exists.** It held two documents and both are finished:
`RESEARCH_PLAN_2026-08-30.md` was executed in full (Phases A–D, all recorded in
`evidence/`) and `ZONE_AUDIT.md` had its premise settled by a different route.
Both moved to `archive/` on 1 Sept 2026 with a header saying why. Recreate the
folder when there is genuinely open work to put in it.

**`evidence/`** — completed experiments and the results they produced. These are
the reason to trust or distrust any claim this project makes.

*Do not edit a document in here.* Each pre-registration states a bar **before**
a run and records the result **after** it, and that ordering is the only thing
that makes the result mean anything. A result whose configuration is lost is not
a result. If a question needs re-asking, write a new pre-registration.

**`archive/`** — superseded, stale, or answered. Kept because it is not in git
and because a stale document still records *why* a decision was made. Read the
warning at the top of each one before quoting a number from it.

**`reference/`** — third-party source material. Not ours, not edited, not
published.

## What is in git and what is not

`.gitignore` ignores `docs/*` with named exceptions. Tracked and public:

- `docs/ROADMAP.md`
- `docs/README.md` (this file)
- `docs/STATE_OF_MERIDIAN_*.md`
- `docs/evidence/*_AB.md`, `docs/evidence/README.md`, and the four phase records
  (`PHASE_B_IC.md`, `PHASE_C_COMBINE.md`, `PHASE_D_NONLINEAR.md`,
  `STAGE0_MAKER_FILL.md`)
- `docs/archive/RESEARCH_PLAN_*.md` — the exception followed the file when it
  was archived, rather than silently untracking a public document

Everything else — `archive/`, the playbook PDF, working notes — stays local.

**The exceptions are per-directory and they are fragile.** A `!docs/*_AB.md`
pattern matches one path segment only, and git will not descend into an ignored
directory at all. Moving the five `_AB.md` files into `evidence/` silently turned
five tracked files into deletions until the ignore rules were updated to match.
If you move a tracked document, check `git status` before committing.

**Everything under `archive/` and `reference/` exists on exactly one laptop.**
That is a real risk and it is not solved. If any of it matters, the fix is to
track it — which also publishes it, since the repository is public.

## Moving a document between folders

That is the whole point of the layout, so do it freely — but say why in the
commit, and if the document is tracked, confirm the ignore rules still reach it
at its new path.
