# Guidance by contribution type

Select only the relevant type and sections. These questions shape the argument;
they do not require new experiments or fill missing evidence. Venue templates and
author instructions control the final structure.

## Systems and research infrastructure

State the problem, target workload and operational assumptions. Explain the main
design choice, alternatives and tradeoffs. Keep architecture, implementation and
observed behavior distinguishable. Evaluation can compare end-to-end behavior,
component contributions, resource use and scaling when those observations exist.

For an Agent platform, trace a user task through execution and review. A protocol
fixture, local development run and packaged release demonstrate different scopes.
Do not claim deployment, multi-platform reliability or scientific validity from
a unit test or UI screenshot. A missing ablation is a gap only if the claim needs it.

## Empirical ML and numerical methods

Define the task, data split, objective and baseline conditions before comparing
results. Retain the full evaluation population, treatment of failed runs,
repetitions and variability. Separate tuning, exploratory analysis and final
evaluation. Identify missing controls instead of claiming a causal explanation
from a score difference alone.

## Engineering and simulation

Retain units, boundary/initial conditions, constraints, solver settings and
measurement definitions. Simulation, hardware experiments and deployment are
different evidence. Explain whether a guarantee is theoretical, solver-certified,
observed on the tested cases or merely a goal. A timeout does not imply infeasibility
or absence of an incumbent without the corresponding record.

## Literature synthesis

Organize by question or method rather than a list of paper summaries. Keep original
source versions and inspected passages. Identify competing findings and differences
in populations, methods and measurements. A convenience collection is not a systematic
review unless the corresponding search and selection protocol was actually followed.

## Theoretical and position papers

For theory, bind statements to definitions, assumptions and actual proof steps;
do not force them into an experiment-result schema. For a position paper, separate
normative proposals, premises, examples and empirical claims. Evidence can bound
an argument without constituting an experimental validation of the proposal.

## Section purposes

- Introduction: research problem, evidenced gap, contribution and its scope.
- Method/design: what was done, assumptions, choices and enough detail to follow it.
- Results: observations that answer the stated questions, including relevant failures.
- Discussion: interpretation, competing explanations and bounded generalization.
- Related work: source-supported comparisons and differences in conditions.
- Abstract/conclusion: claims consistent with the completed body and observed evidence.

Choose figures and tables for the question they answer. Use source-backed curves,
values and assets. Concept diagrams can explain design; they are not experimental
results. Preserve original research figures and formulas when discussing sources.
