# docs — what is here and what it is worth

Reorganised 9 September 2026. Nothing has ever been deleted; a document that
stops being current is moved to `archive/` with a header saying what replaced
it. Most of `docs/` is outside git, so a delete here is unrecoverable.

## Where to start

| you want | read |
|---|---|
| **what runs today** | [`STATE.md`](STATE.md) |
| why the product has this shape | [`END_STATE_A_DESIGN.md`](END_STATE_A_DESIGN.md) |
| what gets built next, and the bar each layer must clear | [`PRODUCT_LAYERS.md`](PRODUCT_LAYERS.md) |
| the individual experiments and their bars | [`evidence/README.md`](evidence/README.md) |
| the prompt the outside analyst is given | [`SIM_PROMPT.md`](SIM_PROMPT.md) |
| open frontend work | [`FRONTEND_AUDIT.md`](FRONTEND_AUDIT.md) |
| how the directional programme ended | [`archive/BRIEFING_FOR_REVIEW.md`](archive/BRIEFING_FOR_REVIEW.md) |

## The folders

**`evidence/`** — completed experiments and the results they produced. These
are the reason to trust or distrust any claim this project makes.

*Do not edit a document in here.* Each pre-registration states a bar **before**
a run and records the result **after** it, and that ordering is the only thing
that makes the result mean anything. A result whose configuration is lost is
not a result. If a question needs re-asking, write a new pre-registration.

**`archive/`** — superseded, finished, or answered. Every document has a header
saying which it is and what replaced it. A stale document still records *why* a
decision was made, which is usually the part worth keeping.

**`reference/`** — third-party source material. Not ours, not edited, not
published.

`active/` does not exist. Recreate it when there is genuinely open work that
does not fit `PRODUCT_LAYERS.md`.

## What moved on 9 September 2026, and why

| document | where it went | why |
|---|---|---|
| `STATE_OF_MERIDIAN_2026-09-01.md` | `archive/` | describes the trade planner deleted in `a2056ff`; replaced by `STATE.md` |
| `ROADMAP.md` | `archive/` | §1–2 self-declared superseded; §3 catalogues defects in code that no longer exists. §5, §7 and §8 are still the methodology of record |
| `BRIEFING_FOR_REVIEW.md` | `archive/` | the review it was written for happened, and produced the pivot |
| `BRIEFING_PROMPT.md` | merged into the above | it was the cover letter for that one document, not a document |
| `SIM_JOURNAL_PLAN.md` | `archive/` | all seven phases passed and shipped in `456aa62` |

Nothing was destroyed. All five are tracked in git at their new paths, so
`git log --follow` still reaches every earlier version.

## What is in git and what is not

`.gitignore` ignores `docs/*` with named exceptions. Tracked and public:

- `docs/README.md` (this file), `docs/STATE.md`
- `docs/END_STATE_A_DESIGN.md`, `docs/PRODUCT_LAYERS.md`
- `docs/SIM_PROMPT.md`, `docs/FRONTEND_AUDIT.md`
- `docs/evidence/` — the `_AB.md` files, the phase and layer records, `README.md`
- `docs/archive/` — `RESEARCH_PLAN_*.md`, and the five documents archived on
  9 Sept 2026, whose exceptions followed them to their new paths

Everything else — the rest of `archive/`, the playbook PDF, working notes —
stays local.

**The exceptions are per-directory and they are fragile.** A `!docs/*_AB.md`
pattern matches one path segment only, and git will not descend into an ignored
directory at all. Moving the five `_AB.md` files into `evidence/` silently
turned five tracked files into deletions until the ignore rules were updated to
match. The same trap was avoided in the 9 Sept move only by editing
`.gitignore` **before** running `git mv`.

If you move a tracked document, check `git status` before committing.

**Everything under `archive/` and `reference/` that is not whitelisted exists
on exactly one laptop.** That is a real risk and it is not solved. If any of it
matters, the fix is to track it — which also publishes it, since the repository
is public.
