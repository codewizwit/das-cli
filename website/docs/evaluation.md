---
id: evaluation
title: Does the index earn its tokens?
---

## The test

Ten questions with mechanically checkable answers, about a 98-file documentation corpus,
asked four ways: with no documentation available, by searching the raw files, by navigating
the index das builds now, and by navigating the index the previous release built. Five runs
per condition per question, 200 runs, zero failures, $4.29. Same corpus, same model, same
tool permissions, same grader. The only thing that varied was how the agent reached the
documentation.

## The result

| How the model reached the documentation | Accuracy | Doc tokens read | Variance (sd) | Cost |
| --- | --- | --- | --- | --- |
| Nothing available | 11/50, 22% | none to read | n/a | $0.88 |
| Searched the raw files | 49/50, 98% | 190,633 | 3,314 | $1.29 |
| **The index, das (current version)** | **50/50, 100%** | **82,806** | **679** | **$0.94** |
| The index, das (previous version) | 44/50, 88% | 260,109 | 2,527 | $1.18 |

The index read **2.3x fewer documentation tokens** than search for the same answers, and it
was lower on all ten questions, from 0.17x on the question whose answer has to be described
rather than matched, to 0.78x where one obvious search term lands it. Per-question variance
fell **4.9x**. It scored the highest accuracy of the four conditions. The previous release
read **1.4x more** than plain search.

## What it means

**Retrieval got cheaper and nothing else measurably changed.** The token result has a
margin that survives repetition. The accuracy result does not: 100% against 98% is one
answer in fifty, which no test on 50 runs per arm separates from chance, so it is
non-degradation rather than improvement. The 78-point gap against no documentation is the
large effect, and it belongs to having documentation rather than to how it is reached,
since plain search collects the same 98%.

**What moved was the structure, not the retrieval method.** The two index arms differ only
in which build generated the skill. Between them, authored `description` frontmatter
reaching an index entry went from 8 of 98 to 98 of 98, and resource bodies went from 0 of
98 byte-identical to their source to 98 of 98. Five earlier comparisons of retrieval method
all returned a tie. The one that moved was the one that varied how much of the authored
layer survived generation.

**Where it does not apply.** One corpus, where every file carries an authored description,
so a corpus without that layer should not be expected to behave this way. One model. And
the agent was told to use the index; left to choose, an agent has been measured invoking it
0 times in 3, which is the next thing to test.

Method, per-question numbers, raw per-run data and the full write-up are in the repository
under `eval5/unregistered-threeway/`.
