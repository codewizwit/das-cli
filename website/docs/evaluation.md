---
id: evaluation
title: Does the index earn its tokens?
sidebar_position: 4
---

# Does the index earn its tokens?

Six controlled comparisons of how an agent reaches documentation. **Five found nothing.**
The sixth is below.

The honest summary first: on one authored corpus, navigating a generated index reached the
same answers as searching the raw files while reading **2.3x fewer documentation tokens**,
and das (previous version) read **1.4x more** than plain search. Accuracy did not
change. Everything after this paragraph is the method and the limits.

## The result

Ten questions, four conditions, five runs each. 200 runs, zero failures, $4.29.

| How the model reached the documentation | Accuracy | Doc tokens read | Variance (sd) | Cost |
| --- | --- | --- | --- | --- |
| Nothing available | 11/50, 22% | none to read | n/a | $0.88 |
| Searched the raw files | 49/50, 98% | 190,633 | 3,314 | $1.29 |
| **The index, das (current version)** | **50/50, 100%** | **82,806** | **679** | **$0.94** |
| The index, das (previous version) | 44/50, 88% | 260,109 | 2,527 | $1.18 |

Four outcome metrics, named: **accuracy** (answers graded correct), **documentation tokens
read into context** (what retrieval cost), **per-question variance** (standard deviation of
those tokens), and **dollars**.

**Accuracy is not the finding.** 100% against 98% is one answer in fifty. What moved
accuracy was having documentation at all, 22% to 98%.

## Cheaper on every question, and the gap tracks the mechanism

Median documentation tokens over five runs per cell.

| Question | Two documents needed | One search term lands it | Search | Index | Ratio |
| --- | --- | --- | --- | --- | --- |
| q01 | | yes | 1,654 | 1,117 | 0.68 |
| q02 | | yes | 5,648 | 2,237 | 0.40 |
| q03 | | yes | 2,177 | 1,645 | 0.76 |
| q04 | | no | 1,687 | 1,125 | 0.67 |
| q05 | | yes | 1,310 | 1,017 | 0.78 |
| q06 | | no | 5,270 | **1,068** | **0.20** |
| q07 | | no | **13,375** | 2,243 | **0.17** |
| q08 | yes | no | 3,080 | 1,453 | 0.47 |
| q09 | yes | no | 2,660 | 2,080 | 0.78 |
| q10 | | no | 2,979 | 1,151 | 0.39 |

Where one obvious search term lands the answer, the index saves 22 to 32 percent. Where no
single term does, it saves 61 to 83 percent. Search's worst case, q07 at 13,375 tokens, is
a question whose answer has to be described rather than matched.

## Cost variance falls 4.9x

Standard deviation per question is 679 for the index against 3,314 for search, on a mean
2.3x lower. Navigation cost tracks tree depth, which is bounded. Search cost tracks how
common the chosen term happens to be, which is not.

An earlier run raised this at n=22 and declined to lean on it. At 50 runs per arm it holds,
and it is the more durable claim than the mean.

## Why the generator mattered and the retrieval method did not

The two index arms differ only in which build produced the skill. What changed between
them is how much of the corpus's authored metadata reached the index:

| | das (previous version) | das (current version) |
| --- | --- | --- |
| Resource body byte-identical to its source | 0/98 | **98/98** |
| Sentence coverage of source prose | 97.8% | **100%** |
| Authored `description` carried into an index entry | **8/98** | **98/98** |

So the index is a rendering of the authored layer, and the published build was rendering
8% of it. Five prior comparisons of *retrieval method* returned a tie. The comparison that
moved was the one that varied how much structure survived generation.

## The instrument had four defects

Each would have invalidated the result. All four were found before the sweep ran.

1. **`claude -p` with `HOME` overridden is not isolated.** Project-instruction discovery
   walks the working directory's ancestors and excludes only `~/.claude/CLAUDE.md`.
   Overriding `HOME` re-points `~`, so the real user file becomes an ordinary ancestor
   file. Canaries leaked from four of six locations.
2. **`--bare` and `--restricted` remove the mechanism under test.** `--bare` loads no
   skills at all; `--restricted` loads built-ins but not `.claude/skills/`. So the flags
   that close defect 1 cannot be used in any arm that needs a project skill.
3. **`--allowed-tools` only pre-approves.** A Bash call ran and echoed its marker under
   `--allowed-tools Read Grep Glob`. Bash was attempted in 8 of 10 runs in the search arm
   and 2 of 10 in the index arm, so the arms were not tool-matched until every unwanted
   tool was denied explicitly.
4. **An overridden `HOME` does not restrict file reads.** A trial globbed `/Users/**` and
   read files from the real home directory, so a no-documentation arm could reach the
   corpus by absolute path. Path-scoped deny rules do block it, and the absolute-path form
   needs a leading `//`.

Defect 4 was large: under containment the control arm's documentation tokens fell from
33,581 to 4,253. Every sweep now asserts that a trial answers `BLOCKED` when asked to read
the corpus outside its own directory, because a clean sweep with no such control proves
nothing about leakage.

## What this does not show

- **Not an accuracy improvement.** Near ceiling for both the search arm and das (current version),
  so the instrument had little power to detect a small difference either way. The right
  term is non-inferiority, and the right phrasing is no measured degradation.
- **One corpus**, 98 files and about 105,000 tokens, where every file carries an authored
  description. A corpus without that layer should not be expected to behave this way. A
  separate run measured the reverse case: strip the authored layer and the index arm loses
  four checks while search loses one.
- **One model**, `claude-haiku-4-5-20251001`.
- **The agent was told to use the index**, by opening the prompt with the skill as a
  command. Left to choose, an agent has been measured invoking the skill 0 times in 3.
  That gap is unmeasured here and is the next thing to test.
- **One question does not discriminate.** The no-documentation arm answered q03 correctly
  5 of 5, so the control floor is about 2 of 10 rather than 0.
- **Five runs per cell on ten questions.** Enough for the token result, which is consistent
  on every question. Not enough for the accuracy comparison.

## Method

| | |
| --- | --- |
| Builds compared | das 0.3.0, called current version here, against das 0.2.0, called previous version |
| Corpus | 98 markdown files, 105,034 est. tokens, pinned at a commit and copied into every trial |
| Task set | 10 questions, frozen and hashed before any run, 8 single-document and 2 two-document, 4 of 10 landable by one obvious search term |
| Grading | mechanical, required-substring groups per question, with a gate scoring a refusal or a clarifying question as zero |
| Isolation | `env -i`, an empty per-trial `HOME`, a trial root outside the home directory, path-scoped deny rules, and a live containment assertion before the sweep |
| Arms | identical corpus, model, flags and grader; only the route to the documentation differs |

Ground truth was verified against the corpus before the set was frozen, with frontmatter
stripped from the source files first. That check caught three questions labelled
two-document that one file could answer, because every file's frontmatter contains the
field names one question asked for.

The instrument, the raw per-run data and the full write-up are in the repository under
`eval5/unregistered-threeway/`. This run was not pre-registered, and it is not the
registered comparison described in `eval5/PREREGISTRATION.md`, which holds das version as
the only variable on two public corpora.
