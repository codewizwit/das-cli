---
title: "Results: no docs against search against a das index"
description: "Navigating the index from the `1688c38` build reached the same answers as searching the raw files while reading 2.3x less documentation, on every question. 0.2.0, the version published when this ran, reads more than plain search."
metadata:
  id: eval5.unregistered.results
  owner: akelstrom
  updated: 2026-10-19
---

# Does the index earn its tokens?

## The short version

Ten questions about a 98-file documentation corpus, asked four ways, five times each.
200 runs, no failures, $4.29.

Four outcome metrics, named: **accuracy** (answers graded correct), **documentation
tokens read into context** (what the retrieval actually cost), **per-question variance**
(standard deviation of those tokens), and **dollars**.

| How the model reached the documentation | Accuracy | Documentation tokens read | Variance (sd) | Dollars |
| --- | --- | --- | --- | --- |
| Nothing available | 22% | none to read | n/a | $0.88 |
| Searched the raw files | 98% | 190,633 | 3,314 | $1.29 |
| **Navigated the index from `1688c38`** | **100%** | **82,806** | **679** | **$0.94** |
| Navigated the index das 0.2.0 builds | 88% | 260,109 | 2,527 | $1.18 |

**Accuracy: unchanged, 100% against search's 98%, which is one answer in fifty.
Documentation tokens read: 2.3x fewer, and fewer on all ten questions. Per-question
variance: 4.9x lower. Dollars: 27% less.** The published 0.2.0 build reads 1.4x more
documentation than plain search, so that release costs more context than not using
it.

Three things this does **not** say:

- **das is not more accurate.** 100% against 98% is one question out of fifty. Having
  documentation at all is what moved accuracy, from 22% to 98%.
- **One corpus only**, hers, where all 98 files carry an authored description. The index
  is a rendering of that authored layer, so a corpus without one should not be expected
  to behave this way.
- **The model was told to use the index.** Left to choose, agents tend to search instead.
  That is measured elsewhere at 0 of 3 and is not re-tested here.

Everything below is the detail behind those four rows.

---

## What was run

**Not pre-registered, and not experiment 5A or 5B.** `../PREREGISTRATION.md` registers a
two-arm comparison of das versions on TanStack Router and HeroUI using frozen sets from
`../../eval/` and `../../eval4/`. This is a different experiment on a different corpus
with questions authored for it, run before that pre-registration was found. It is kept
because it answers something the registered pair does not: how a das index compares
against search and against nothing, on one corpus, with the generator as one of the arms.

Instrument, the four isolation defects found while building it, and the full limits:
[`METHOD.md`](METHOD.md). Raw data: [`instrument/`](instrument/).

| Arm | Documentation reachable | Tools | Route |
| --- | --- | --- | --- |
| **C** | none | Read, Grep, Glob | the control |
| **A** | the raw corpus | Read, Grep, Glob | search |
| **E** | a skill from `1688c38` | Read, Skill | the generated index |
| **F** | a skill from das 0.2.0 | Read, Skill | the generated index |

Corpus `~/wizwit-knowledge` @ `1a1fb27`, 98 files, 105,034 est. tokens. Task set sha256
`e87cf665…`. Model `claude-haiku-4-5-20251001`. Five runs per cell. E and F open the
prompt with `/wizwit`, so invocation is not a variable. Grep and Glob are denied in E and
F, so the index is the only route. A containment assertion passed before the sweep: a
trial asked to read the corpus outside its own directory must answer `BLOCKED`.

## The numbers

| Arm | Accuracy | Doc tokens total | Median per question | Mean (sd) | Cost | Median turns |
| --- | --- | --- | --- | --- | --- | --- |
| C | 11/50, 22% | 57,976 | 191 | 1,160 (2,653) | $0.88 | 3 |
| A | 49/50, 98% | 190,633 | 2,610 | 3,813 (3,314) | $1.29 | 6 |
| **E** | **50/50, 100%** | **82,806** | **1,453** | **1,656 (679)** | $0.94 | 4 |
| F | 44/50, 88% | 260,109 | 4,291 | 5,202 (2,527) | $1.18 | 3 |

Documentation tokens are the characters tool results returned, at das's own prose ratio of
4 characters per token. **Dollars moved 27% while documentation tokens moved 2.3x**,
because spend is dominated by the cached system prompt. Quote the token figure.

### 1. Cheaper on every question

Median of five runs per cell.

| Question | Hops | One search term lands it | A | E | F | E/A |
| --- | --- | --- | --- | --- | --- | --- |
| q01 | 1 | yes | 1,654 | 1,117 | 4,532 | 0.68 |
| q02 | 1 | yes | 5,648 | 2,237 | 3,045 | 0.40 |
| q03 | 1 | yes | 2,177 | 1,645 | 4,930 | 0.76 |
| q04 | 1 | no | 1,687 | 1,125 | 7,840 | 0.67 |
| q05 | 1 | yes | 1,310 | 1,017 | 4,050 | 0.78 |
| q06 | 1 | no | 5,270 | **1,068** | 3,636 | **0.20** |
| q07 | 1 | no | **13,375** | 2,243 | 3,069 | **0.17** |
| q08 | 2 | no | 3,080 | 1,453 | 3,636 | 0.47 |
| q09 | 2 | no | 2,660 | 2,080 | 3,636 | 0.78 |
| q10 | 1 | no | 2,979 | 1,151 | 9,245 | 0.39 |

The gap tracks the mechanism. Where one obvious search term lands the answer, the index
saves 22 to 32 percent. Where no single term does, it saves 61 to 83 percent. Search's
worst case, q07 at 13,375 tokens, is a question whose answer has to be described rather
than matched.

### 2. More predictable, by 4.9x

Standard deviation per question is 679 for the index against 3,314 for search, on a mean
2.3x lower. Navigation cost tracks tree depth, which is bounded. Search cost tracks how
common the chosen term happens to be, which is not. `../../eval/results.md` raised this at
n=22 and declined to lean on it. At 50 runs per arm it holds, and it is more durable than
the mean.

### 3. The published build loses to search

0.2.0 read 260,109 tokens against search's 190,633. The new build reads 0.43x of what
0.2.0 reads. Arms E and F differ only in which das generated the skill.

### Accuracy, per question

Passes out of five.

| | q01 | q02 | q03 | q04 | q05 | q06 | q07 | q08 | q09 | q10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C | 1 | 2 | 5 | 1 | 1 | 0 | 0 | 1 | 0 | 0 |
| A | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 4 |
| **E** | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| F | 5 | 5 | 2 | 5 | 5 | 5 | 5 | 5 | 5 | 2 |

E against A is not a difference. **F's 44/50 rests on two questions**, q03 and q10, each
failed three times in five, and both are questions where 0.2.0's index entry is a
truncation rather than the authored description. That mechanism is measured in
[`structural.md`](structural.md) at 8 of 98 against 98 of 98. Six discordant runs all
favouring the new build is suggestive and no more.

**q03 does not discriminate.** The no-documentation arm answered it 5 of 5, because "top
level" is a plausible guess for where a frontmatter field sits. Drop it on any reuse.
Without it the control scores 6 of 45.

## Limits

- One corpus, hers, 98 files, every file carrying an authored `description`. The index
  advantage renders that layer. The October study measured the reverse case: strip the
  authored layer and the index arm loses four checks while search loses one.
- Haiku only. Invocation and descent are model behaviours.
- Accuracy is near ceiling for A and E, so this instrument cannot separate them there.
- Five runs per cell on ten questions. Enough for the token result, which is consistent
  on every question. Not enough for the accuracy comparison.
- E and F were force-invoked with `/wizwit`. Auto-invocation is unmeasured here and
  previously scored 0 of 3.
- Two of ten questions require two documents. A genuinely multi-hop set was not authored.

## What may and may not be said

Following `~/wizwit-knowledge/evidence/claims.md`.

| May be said | May not be said |
| --- | --- |
| On a 98-file authored corpus, navigating the generated index reached the same answers as searching the raw files while reading 2.3x less documentation, lower on all ten questions | That das improves accuracy. 50/50 against 49/50 is not a difference |
| The index's per-question cost varied 4.9x less than search's | That this generalises to a corpus without an authored frontmatter layer |
| das 0.2.0 read 1.4x more documentation than search; the new build reads 0.43x of what 0.2.0 reads | Any figure for a model other than Haiku, or a corpus other than this one |
| Documentation access moved accuracy from 22% to 98% | That 22% is a floor. One guessable question supplies 5 of those 11 passes |

## Appendix: single run per cell

The first contained pass, kept rather than overwritten. Same corpus, same set, one run
each.

| Arm | Correct | Doc tokens | Median per question | Cost |
| --- | --- | --- | --- | --- |
| C | 2/10 | 4,253 | 99 | $0.1602 |
| A | 10/10 | 42,385 | 3,158 | $0.2748 |
| E | 10/10 | 16,832 | 1,565 | $0.2461 |
| F | 9/10 | 37,426 | 3,636 | $0.2372 |

Before the containment fix, arm C read 33,581 tokens because it was reaching documentation
outside its trial. That figure appears nowhere above and is recorded as defect 4 in
[`METHOD.md`](METHOD.md).
