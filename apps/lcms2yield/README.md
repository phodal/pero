# LCMS2Yield

A research App for the pinned XtalPi release `xtalpi-inc/lcms2yield` at
`1018ba0ae81259a337e88956b3194d9ebacd71ef`. The panel draws the released
reaction-yield table. A weight rerun is a separate action and compares
correction factors with the released prediction column. The paper conclusion
stays unsettled: the 4.74 percentage-point figure is arithmetic on published
yield columns, not a new chromatogram.

Inference software is the Environments method `lcms2yield.inference`
(CPython 3.12 for this trial, with the pinned chemistry stack). Cluster connection drafts stay
in Compute. This App does not submit jobs, clone the repository, or train.

The reaction table in `backend/data/Reaction.csv` is the upstream file named
in `THIRD_PARTY_NOTICES.md`. Weights stay in a checkout you provide.

```sh
npm --prefix apps/lcms2yield run typecheck
npm --prefix apps/lcms2yield test
node scripts/build/apps.mjs --app lcms2yield
```
