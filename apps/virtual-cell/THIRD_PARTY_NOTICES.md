# Third-party notices

## CELLxGENE PBMC3k reference fixture

`ui-src/pbmc-atlas.json` is a small derived subset of the public CELLxGENE
`example-dataset/pbmc3k.h5ad` at source revision
`76a39fcf92da57c9e4fd59831ad805a3b007da8c` (file SHA-256
`0db367b991dd95809732b218539ede489bea99113807f62ebd7ccc970025fe38`).
CELLxGENE credits Scanpy and its authors for this example dataset.
The fixture retains every fourth original cell, original cell IDs, stored
X_umap, Louvain annotations and 12 named raw.X values. The extraction script
makes no inference, normalization or new embedding. It is an observed reference
example and must not be presented as a Norman perturbation or predicted cell.
No CELLxGENE names/logos are used as Point product branding.

Upstream: https://github.com/chanzuckerberg/cellxgene

# The MIT License (MIT)

Copyright (c) 2017-2026 Chan Zuckerberg Initiative

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Three.js

The App bundles Three.js 0.185.1 and its OrbitControls module.

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Point source and Pero adaptation

The domain computation, scientific views and reference reports are adapted from
`phodal/point/apps/virtual-cell`, version 0.2.0 at source revision
`dcd549a9cc8807eda5ce682eef4621afbd9a02d9`. The source App declares Apache-2.0;
the license text is retained in `licenses/Apache-2.0.txt`. Pero changes the SDK,
frame entry, theme bindings and authenticated backend transport. The historical
Point data schema identifiers are retained for compatible imports.

## React and ReactDOM

This Pero frame bundles React 19.2.8, ReactDOM 19.2.8 and their scheduler
dependency, MIT License, Copyright (c) Meta Platforms, Inc. and affiliates.
Their complete license texts are retained under `licenses/`. These are local
bundled libraries, not externally loaded scripts or a hosted service.
