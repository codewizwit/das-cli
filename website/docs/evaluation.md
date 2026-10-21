---
id: evaluation
title: Does the index earn its tokens?
---

## What was being tested

When an AI coding agent needs to answer a question from a team's documentation, it normally
searches the files, the way you would with grep. That works, but it returns whatever text
happens to sit near the matching word, and the agent pays for all of it.

`das` offers a different route. It turns a documentation set into a table of contents: a
top-level index that names each section and describes it, pointing down to smaller indexes
and finally to the documents themselves. The agent reads the index first and opens only the
page it needs.

The question is whether that is actually better. Reading an index costs tokens too, so it
could easily end up costing more than searching while answering no better.

## How it was tested

Ten questions about a documentation set of 98 files. Each question had a verifiable answer,
so grading was mechanical rather than a judgement call. Every question was asked four
different ways, five times each: 200 runs in total, no failures, $4.29 of model usage.

**The four ways:**

| | What the agent could do |
| --- | --- |
| **No documentation** | Nothing to read. The check that these questions genuinely need the docs |
| **Search** | Read and grep the documentation files directly. The thing worth beating |
| **das index, current release** | Navigate the table of contents das generates, no searching allowed |
| **das index, previous release** | The same, from the previous version of das |

**Held identical across all four:** the documentation, the questions, the model, which tools
were available, and the grader. The only thing that changed was how the agent got to the
documentation.

**What was counted:**

- **Right answers.** A refusal or a question back scored zero, so a non-answer could not pass.
- **Documentation text pulled in**, counted in tokens. This is the real cost of retrieval:
  every token of documentation the agent reads is money spent and space taken from the task
  it is actually doing.
- **How much that amount varied** from one question to the next. A method whose cost is
  predictable is easier to plan around than one with a low average and occasional spikes.
- **Dollars** of model usage.

## The result

| | Right answers | Documentation pulled in, all 50 runs | Per question, least to most | Cost |
| --- | --- | --- | --- | --- |
| No documentation | 11/50, 22% | nothing to read | n/a | $0.88 |
| Search | 49/50, 98% | 190,633 tokens | 1,310 to 13,375 | $1.29 |
| **das index, current release** | **50/50, 100%** | **82,806 tokens** | **1,017 to 2,243** | **$0.94** |
| das index, previous release | 44/50, 88% | 260,109 tokens | 3,045 to 9,245 | $1.18 |

**Searching and the current release both answered almost everything correctly. The current
release did it while reading 2.3x less documentation.** It read less on all ten questions.
The widest gap was on the question whose answer has to be described rather than matched by
a keyword, where it read about one sixth of what searching did. The narrowest was where one
obvious keyword lands the answer, and even there it read less.

Its cost was also far more predictable. Searching read as little as 1,310 tokens on one
question and as much as 13,375 on another, a tenfold spread, because a search costs
whatever the word you picked happens to be common in. The index stayed between 1,017 and
2,243, roughly twofold, because walking a tree costs whatever the tree is deep. The bill
was 27% lower.

**The previous release was worse than searching on both measures.** It read 1.4x more
documentation, and it got 44 of 50 right against searching's 49, so six behind the current
release.

## What it means

**Retrieval got cheaper. Accuracy held rather than improved.** The cost result is solid: it
held on every question. The accuracy result is not a win. 100% against 98% is a single
answer out of fifty, which is well inside what chance produces at this sample size. The
honest claim is that nothing got worse.

**The big accuracy effect is having documentation at all.** 22% with none, 98% with it. That
gap belongs to the documentation existing, not to how the agent reaches it, because plain
searching collects the same 98%.

**What separated the two das versions was the descriptions.** Every file here carries a
one-line description its author wrote on purpose. The old version carried 8 of those 98
into the index and filled the rest with sentences chopped off mid-word. The new one carries
all 98. An index is only a rendering of what someone already wrote, and that is the whole
difference. Five earlier runs of this comparison, on other documentation sets, all came out
even; this is the first one that moved.

**A bad index is worse than no index.** The previous release is the proof: it charged more
than searching and answered fewer questions. An index the agent has to walk through costs
something, so if it is not carrying real information, the agent pays and gets nothing.

## Where this does not apply

- **One documentation set**, and one where every file carries an author-written description.
  A set without that will not behave this way, and a separate test confirmed it: strip those
  descriptions out and the index loses more ground than searching does.
- **One model.**
- **The agent was told to use the index.** Left to decide for itself, an agent has been
  measured reaching for the index 0 times out of 3 and searching instead. Closing that gap is
  the next piece of work, and until it is closed these numbers describe an agent that was
  pointed at the index rather than one that chose it.

Method, per-question numbers and raw per-run data are in the repository under
`eval5/unregistered-threeway/`.
