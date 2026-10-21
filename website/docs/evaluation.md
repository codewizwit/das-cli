---
id: evaluation
title: Does the index earn its tokens?
---

## The test

Ten questions with mechanically checkable answers about a 98-file documentation corpus,
asked four ways, five runs each. 200 runs, zero failures, $4.29.

**Controlled for:** the documentation corpus, pinned at a commit and copied into every
trial; the task set, frozen and hashed before the first run; the model; the tool
permissions; and the grader. None of these differ between arms.

**The negative control: no documentation available.** An arm expected to fail, whose job is
to prove the questions require the corpus rather than being answerable from what the model
already knows. It scored 22%, so they do. Without it the other three numbers mean nothing.

**The baseline: search the raw files.** Read, grep and glob over the documentation in its
original form, which is what an agent does today and the thing worth beating.

**The variable: the das-cli index.** Two arms navigated a `das`-generated `_das-index.md`
tree instead of searching the files, one skill built by the previous release and one by the
current release. Between those two arms the only difference is which version generated the
skill, so anything separating them is attributable to the generator.

**What was measured:** accuracy, graded mechanically with a gate that scores a refusal or a
clarifying question as zero; documentation tokens read into context, which is what
retrieval actually cost; the per-question variance of those tokens; and dollars.

## The result

| Arm | Accuracy | Doc tokens read | Variance (sd) | Cost |
| --- | --- | --- | --- | --- |
| Negative control, no documentation | 11/50, 22% | none to read | n/a | $0.88 |
| Baseline, searched the raw files | 49/50, 98% | 190,633 | 3,314 | $1.29 |
| **The das-cli index, current release** | **50/50, 100%** | **82,806** | **679** | **$0.94** |
| The das-cli index, previous release | 44/50, 88% | 260,109 | 2,527 | $1.18 |

**Against the baseline, the current release read 2.3x fewer documentation tokens for the
same answers.** It was lower on all ten questions, from 0.17x on the question whose answer
has to be described rather than matched by a search term, to 0.78x where one obvious term
lands it. Per-question variance fell 4.9x and dollars fell 27%. It scored the highest
accuracy of the four arms.

**The previous release lost on both.** It read 1.4x more than plain search and scored 44 of
50, five answers below the baseline and six below the current release.

## What it means

**Retrieval got cheaper, and accuracy held rather than improved.** The token result has a
margin that survives repetition. The accuracy result does not: 100% against the baseline's
98% is one answer in fifty, which no test on 50 runs per arm separates from chance, so it
is non-degradation and not an improvement. The 78-point gap against no documentation is the
large effect, and it belongs to having documentation rather than to how it is reached, since
plain search collects the same 98%.

**What moved was the structure, not the retrieval method.** The two index arms differ only
in which build generated the skill. Between them, authored `description` frontmatter
reaching an index entry went from 8 of 98 to 98 of 98, and resource bodies went from 0 of 98
byte-identical to their source to 98 of 98. Five earlier comparisons of retrieval method all
returned a tie. The one that moved was the one that varied how much of the authored layer
survived generation.

**A badly built index is worse than no index.** The previous release is the evidence: it
cost more tokens than searching the files and answered fewer questions correctly. The index
is a rendering of the authored layer, so when little of that layer reaches it, an agent pays
for navigation and gets nothing back.

**Where it does not apply.** One corpus, in which every file carries an authored
description, so a corpus without that layer should not be expected to behave this way. One
model. And the agent was told to use the index; left to choose, an agent has been measured
invoking it 0 times in 3, which is the next thing to test.

Method, per-question numbers, raw per-run data and the full write-up are in the repository
under `eval5/unregistered-threeway/`.
