# CLAUDE.md

## Working principles

Behavioral guardrails. Bias toward caution over speed. For trivial tasks, use
judgment.

### 1. Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Self-check: "Would a senior engineer say this is overcomplicated?" If yes,
simplify.

### 3. Surgical changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

Test: every changed line should trace directly to the request.

### 4. Goal-driven execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria
("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs,
fewer rewrites due to overcomplication, and clarifying questions come before
implementation rather than after mistakes.

## Releases

Releases are automated via [release-please](https://github.com/googleapis/release-please).
Version bumps and `CHANGELOG.md` updates happen from Conventional Commits — never
edit `package.json`'s `version` field by hand.

### Conventional Commits

Every commit message on `main` must follow Conventional Commits. The prefix
determines the version bump:

| Prefix             | Bump          | Example                                 |
| ------------------ | ------------- | --------------------------------------- |
| `feat:`            | minor (0.X.0) | `feat: add CSV export to records table` |
| `fix:`             | patch (0.0.X) | `fix: handle empty workspaces`          |
| `feat!:` / `fix!:` | major (X.0.0) | `feat!: rename SDK entry point`         |
| `chore:`           | none          | `chore: bump dependencies`              |
| `docs:`            | none          | `docs: update README install steps`     |
| `refactor:`        | none          | `refactor: extract pty manager`         |

Breaking changes can also be declared with a `BREAKING CHANGE:` footer in the
commit body.

When opening a PR, the **PR title** should be a Conventional Commit (squash
merges use the PR title as the commit message).

### Release flow

1. Merge PRs to `main` using Conventional Commit titles.
2. The `Release` workflow runs and either opens a new **Release PR** titled
   `chore(main): release X.Y.Z` or updates the existing one with the pending
   `package.json` bump and `CHANGELOG.md` entries.
3. When ready to ship, merge the Release PR.
4. release-please tags `vX.Y.Z`, creates a GitHub Release, and the same
   workflow builds signed + notarized arm64 + x64 DMGs and attaches them to the
   release.

### Rebuilding DMGs for an existing tag

Use the workflow's `workflow_dispatch` trigger and pass the tag name (e.g.
`v0.2.0`). DMGs will be rebuilt and re-attached to that release.
