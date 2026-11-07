# LCMS2Yield

A research App for the pinned XtalPi release `xtalpi-inc/lcms2yield` at
`1018ba0ae81259a337e88956b3194d9ebacd71ef`. The panel draws the released
reaction-yield table. A weight rerun is a separate action and compares
correction factors with the released prediction column. The paper conclusion
stays unsettled: the 4.74 percentage-point figure is arithmetic on published
yield columns, not a new chromatogram.

Inference software is the Environments method `lcms2yield.inference`.
Preparing the App installs PyTorch 2.3, PyG and RDKit into this App's own
CPython 3.12 environment, separate from Control Lab, and downloads the pinned
upstream release into the App data directory. Cluster connection drafts stay
in Compute. This App does not submit jobs or train.

The reaction table in `backend/data/Reaction.csv` is the vendored upstream file
named in `THIRD_PARTY_NOTICES.md`. The model, weights and the other released
tables are downloaded, not stored in this repository.

```sh
npm --prefix apps/lcms2yield run typecheck
npm --prefix apps/lcms2yield test
node scripts/build/apps.mjs --app lcms2yield
```
