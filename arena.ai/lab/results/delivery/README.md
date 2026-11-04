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

## Pushing the branch

The sandbox that produced this audit has **no GitHub credentials**, so the
push could not be performed from here:

```
$ git push -u origin audit/arena-official-validation
fatal: could not read Username for 'https://github.com': No such device or address
```

From a machine with credentials, the branch is pushed with:

```bash
git push -u origin audit/arena-official-validation
```

Two transfer artefacts are produced in this directory (they are **not**
committed, because they are large and redundant with the branch):

| File | Size | Use |
| --- | ---: | --- |
| `arena-official-validation.bundle` | ~19 MB | `git clone arena-official-validation.bundle work && cd work && git checkout audit/arena-official-validation` |
| `arena-official-validation.patch` | ~23 MB | `git am < arena-official-validation.patch` on top of the baseline commit |

Both are verified: the patch reverse-applies cleanly against the audited
tree, and the bundle carries the full history of the branch.
