# docs — what is here and what it is worth

Reorganised 30 Aug 2026. Nothing was deleted; `docs/` has almost no git history,
so a delete here is unrecoverable and everything superseded was moved to
`archive/` instead.

## Where to start

| you want | read |
|---|---|
| what the project is doing next | [`active/RESEARCH_PLAN_2026-08-30.md`](active/RESEARCH_PLAN_2026-08-30.md) |
| what is parked, and why | [`ROADMAP.md`](ROADMAP.md) |
| what has already been tested | [`evidence/README.md`](evidence/README.md) |
| how the app is built | the code — every doc that described the architecture is stale |

## The folders

**`active/`** — current. A document here is either being worked from or has open
questions in it. If it is finished, it belongs in `evidence/`; if it has been
overtaken, it belongs in `archive/`.

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
- `docs/evidence/*_AB.md` and `docs/evidence/README.md`
- `docs/active/RESEARCH_PLAN_*.md`

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
