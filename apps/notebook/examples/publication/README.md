# Frozen multi-panel publication example

Run this explicit local command using an existing Python environment with
Matplotlib. It performs no installation, network access, notebook execution or
Agent call. Notebook remains the editor of the imported frozen snapshot; the
selected command environment owns figure generation.

```sh
python apps/notebook/examples/publication/generate_figure.py \
  --output test-results/publication-figure/v1
```

The default input is Paper's reviewed visual transcription of all 100
sepal-length values from Fisher (1936), Table I, printed page 180. It is read
from its existing owner rather than copied into another source fixture. Panel a
shows all observations; panel b shows within-species sums of squares. The sum is
the exact rational `95717/5000` cm² (19.1434), the Table III statistic. This is a
software traceability example, not new experimental evidence or peer review.

Import the emitted `fisher.myst-project.json` using Notebook's **MyST text
project** import. The manuscript references the numbered figure and retains the
exact CSV, editable Python generator and per-panel provenance manifest as
selectable text resources. Its 2040 × 870 PNG is generated at 300 dpi. An
editable-text SVG is retained as an inert downloadable asset; the vector PDF is
delivered alongside the snapshot. Notebook embeds only the admitted PNG. The manifest
pins data/code/artifact SHA-256 values, row ranges, units, environment and command.

For a targeted panel revision, run into another directory:

```sh
python apps/notebook/examples/publication/generate_figure.py \
  --data test-results/publication-figure/v1/data/fisher_table1.csv \
  --panel-b-title 'Within-species sum of squares' \
  --output test-results/publication-figure/v2
```

To change the data or plotting code, edit the retained source resources, export
the snapshot, extract those exact resources and invoke the command with the
edited CSV in a new delivery directory. `--data` requires the complete same
two-species/100-row schema. Modified input bytes are explicitly labeled an
**edited input variant**, even when only whitespace changes; they do not claim
to reproduce the reviewed Fisher transcription. Existing output directories are
refused, so regeneration cannot silently overwrite the previous delivery.
Save each imported snapshot as a Notebook revision to retain old source and
figure bytes. Use **Update from regenerated project** on the same block to import
the next snapshot, then **Save revision** and **Compile saved revision to PDF**.
Old builds keep their exact inputs and PDF. An edited data/code resource marks
its figure stale until the regenerated snapshot is imported. Compilation and preview use the publication controls;
the figure generator does not compile a manuscript or create build state.

All generated outputs belong in ignored `test-results/` or a user-chosen output
directory. Commit neither generated figures nor project snapshots.
