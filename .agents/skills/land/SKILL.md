---
name: land
description: >-
  Land requested changes in the Ei-TypeBomb repository. Invoke only when the
  user explicitly requests landing, merging, or choosing Land Changes; do not
  invoke for review, preparation, passing checks, or skill installation alone.
disable-model-invocation: true
metadata:
  delta-action: land
---

# Land Ei-TypeBomb changes

Use this workflow only after an explicit user request to land the current
changes. That request already authorizes the landing workflow; do not ask for
the same permission again. Complete the landing and verify the result, or
report clearly that it did not land and why.

## Preflight

1. Confirm the repository is Ei-TypeBomb and inspect `git status`, current
   branch, configured remotes, and the intended change diff. Never operate on
   another checkout or another thread's worktree.
2. Preserve unrelated and pre-existing changes. Do not reset, clean, overwrite,
   or stage unrelated files. If changes are uncommitted, identify which belong
   to the requested work and stage only those. If scope cannot be separated
   safely, stop and ask.
3. Check the target branch and repository settings through the available
   GitHub interface. Use `main` for ordinary feature work unless the user or
   repository configuration specifies otherwise. Use `production` only when
   that is the intended destination.
4. Check `gh auth status`. Use the configured source remote (normally
   `origin`), never the `local` backlink, for publication. If GitHub
   authentication or access is unavailable, stop before publishing or
   merging.
5. Create or use an issue-named feature branch such as
   `aoiihara/dev-472`. Preserve the existing branch if it already represents
   this change. Do not rewrite shared history or force-push.

## Verify locally

Inspect the changed paths and their `package.json` scripts; run the relevant
checks before publishing. Supported repository commands include:

- Node backend: `npm test --prefix backend/server`,
  `npm run typecheck --prefix backend/server`, and
  `npm run build --prefix backend/server`.
  (`backend/server/package.json`, scripts `test`, `typecheck`, `build`)
- Cloudflare backend: `npm test --prefix backend/cloudflare`,
  `npm run typecheck --prefix backend/cloudflare`, and
  `npm run build --prefix backend/cloudflare`.
  (`backend/cloudflare/package.json`, scripts `test`, `typecheck`, `build`)
- Client: `npm run lint --prefix client`,
  `npm run build --prefix client`, and, when playground behavior is affected,
  `npm run test:playground --prefix client`.
  (`client/package.json`, scripts `lint`, `build`, `test:playground`)

Both backend projects share `backend/shared/`; changes there require checks for
both backends. Run additional checks required by the actual changed code or
repository settings. Do not treat local checks as a substitute for required
PR checks.

## Publish and review

1. Prepare a concise, accurate commit and PR description from the actual diff.
   Follow existing issue/branch context; do not invent issue IDs, test results,
   or human-authored text required by policy.
2. Push the feature branch to the configured source remote and create or update
   a PR using the installed GitHub tooling. The repository's recent history
   shows PR merge commits; use a merge commit unless current repository
   settings explicitly require a different strategy.
3. For a PR targeting `production`, apply exactly one of `Major`, `Minor`, or
   `Patch`. `.github/workflows/validate-release-label.yml` enforces this for
   production PRs, and `.github/workflows/release-tag.yml` creates the
   corresponding release after merge.
4. Inspect the PR's actual base, head SHA, review decision, required check
   names, and applicable branch protection/merge queue. Obtain all required
   reviews and ensure every required check has passed for the exact head being
   landed. Use `gh pr checks <PR> --required` to inspect required checks; do
   not merge while checks are pending, failing, missing, or unverifiable.
5. If a check fails, investigate and fix the cause, then rerun relevant local
   checks, publish the resulting head, and wait for the new head's required
   checks. Never treat results from an earlier commit as approval.

## Resolve conflicts

Resolve conflicts automatically only when the intended result is clear from
the change, surrounding code, and project conventions. Preserve unrelated
work. If intent is ambiguous, resolution risks data loss, or checks fail after
resolution, stop and ask the user rather than guessing.

## Merge and confirm

Once all required reviews and checks have passed for the current PR head, merge
using GitHub's merge-commit strategy (`gh pr merge <PR> --merge`). Do not use
`--admin`, bypass branch protections, or force a merge. Honor any merge queue
required by the destination branch.

Afterward, verify that GitHub marks the PR merged and identify its merge commit
and destination branch. Fetch the destination branch from the configured source
remote and verify the merge commit is reachable from it. Report completion
only after confirming the landing; otherwise state that the change did not
land and describe the blocker.
