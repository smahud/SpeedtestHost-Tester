# Delivery state

The audit work is committed on the branch `audit/arena-official-validation`
in the repository `https://github.com/smahud/SpeedtestHost-Tester`.

| Item | Value |
| --- | --- |
| baseline commit | `eab16976a4dbf48f36b0d81da5413cf2860e3cfa` |
| audit commit | `c9fd87e5e65ad949be0fe417542d5a8e46a8e888` |
| files touched | `arena.ai/` only (verified with `git show --name-only --format= HEAD`) |
| force-push | never used |
| other agents' branches | untouched |

## Pushing the branch — **done**

The branch was pushed with the repository owner's fine-grained PAT, passed
through a transient credential helper so that nothing was written to
`.git/config` and nothing was committed:

```bash
GIT_TERMINAL_PROMPT=0 git \
  -c credential.helper='!f() { echo username=x-access-token; echo "password=$GH_PAT"; }; f' \
  push -u origin audit/arena-official-validation
```

| Item | Value |
| --- | --- |
| remote branch | `origin/audit/arena-official-validation` |
| remote tip | `d6c380351a43046578237218b020ff6c3db220a1` (= local `HEAD`) |
| pull request | **#1** — https://github.com/smahud/SpeedtestHost-Tester/pull/1 |
| base branch | `main` (untouched, still `eab16976a4dbf48f36b0d81da5413cf2860e3cfa`) |
| other agents' branches | untouched (`origin/audit/z-ai-official-validation` still `f0f3f0e`) |
| force-push | never used |
| token in `.git/config` / tracked files / working tree | **absent** (verified) |

Two transfer artefacts are produced in this directory (they are **not**
committed, because they are large and redundant with the branch):

| File | Size | Use |
| --- | ---: | --- |
| `arena-official-validation.bundle` | ~19 MB | `git clone arena-official-validation.bundle work && cd work && git checkout audit/arena-official-validation` |
| `arena-official-validation.patch` | ~23 MB | `git am < arena-official-validation.patch` on top of the baseline commit |

Both are verified: the patch reverse-applies cleanly against the audited
tree, and the bundle carries the full history of the branch.  The bundle was
also uploaded to Google Drive; the connector's security filter refused the
`.patch` upload, which is recorded rather than circumvented.
