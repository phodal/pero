# Engine notices

RDKit.txt is the upstream BSD-3-Clause notice from the public pinned release:
https://github.com/rdkit/rdkit/blob/Release_2026_09_1/license.txt

RDKit is provided by the official pinned Python wheel 2026.9.1 in the
Host-managed App environment. Its JavaScript/WASM distribution is not shipped:
it requires dynamic JavaScript generation incompatible with the App CSP.
The builder retains this notice and copies LICENSE files from pinned Mol*,
PDF.js and fflate into dist/licenses.
The twelve independently authored fixtures are CC0-1.0 synthetic data, not measurements.
