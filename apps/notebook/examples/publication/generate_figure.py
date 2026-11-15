"""Explicit local figure generation, separate from Notebook's frozen editing owner.

Requires matplotlib in the selected Python environment; installs nothing and
starts no kernel, Agent, scheduler or service. Generated files are not committed.
"""
import argparse
import base64
import csv
from dataclasses import dataclass
from fractions import Fraction
import hashlib
import io
import json
from pathlib import Path
import platform
import sys


SCRIPT = Path(__file__).resolve()
# The delivered code/figure.py defaults to its sibling data directory; the
# repository entry reads the existing Paper-owned transcription in place.
DATA = (SCRIPT.parents[4] / 'apps/paper-agent/backend/paper_agent/fisher_table1.csv'
        if SCRIPT.name == 'generate_figure.py' else SCRIPT.parent.parent / 'data/fisher_table1.csv')
REVIEWED_SHA256 = '63bc335cdbbecc311a3dced4a28b210a94bc2ccc71b0df5535b72c30091623fc'
DOI = 'https://doi.org/10.1111/j.1469-1809.1936.tb02137.x'
SPECIES = ('setosa', 'versicolor')


@dataclass(frozen=True)
class SpeciesSeries:
    name: str
    lengths_cm: tuple[Fraction, ...]

    @property
    def mean_cm(self):
        return sum(self.lengths_cm) / len(self.lengths_cm)

    @property
    def sum_squares_cm2(self):
        mean = self.mean_cm
        return sum((value - mean) ** 2 for value in self.lengths_cm)


@dataclass(frozen=True)
class FigureDataset:
    source: str
    sha256: str
    series: tuple[SpeciesSeries, ...]

    @classmethod
    def parse(cls, data):
        source = data.decode('utf-8')
        reader = csv.DictReader(io.StringIO(source))
        if reader.fieldnames != ['species', 'row', 'sepal_length_cm']:
            raise ValueError('Expected species,row,sepal_length_cm columns')
        groups = {species: [] for species in SPECIES}
        for index, row in enumerate(reader):
            species = SPECIES[min(index // 50, 1)]
            if (index >= 100 or None in row or row['sepal_length_cm'] is None or row['species'] != species
                    or row['row'] != str(index % 50 + 1)):
                raise ValueError('Require ordered rows 1–50 for setosa then versicolor')
            # Fraction rejects NaN and infinity and retains the authored decimal.
            try:
                value = Fraction(row['sepal_length_cm'])
            except (ValueError, ZeroDivisionError) as error:
                raise ValueError('Sepal length must be a finite positive number in cm') from error
            if value <= 0:
                raise ValueError('Sepal length must be a finite positive number in cm')
            groups[species].append(value)
        if sum(map(len, groups.values())) != 100:
            raise ValueError('Require all 100 observations; missing rows are not omitted')
        return cls(source, hashlib.sha256(data).hexdigest(),
                   tuple(SpeciesSeries(name, tuple(groups[name])) for name in SPECIES))

    @property
    def status(self):
        return 'reviewed-transcription' if self.sha256 == REVIEWED_SHA256 else 'edited-input-variant'


def panel_observations(axis, dataset, colors):
    for group, color, marker in zip(dataset.series, colors, ('o', 's')):
        axis.plot(range(1, 51), [float(value) for value in group.lengths_cm],
                  marker=marker, markersize=2.8, linestyle='none',
                  alpha=.8, color=color, label=group.name.capitalize())
    axis.set(title='Observed sepal lengths', xlabel='Table I observation', ylabel='Sepal length (cm)')
    axis.legend(frameon=False, fontsize=9)


def panel_dispersion(axis, dataset, colors, title):
    values = [float(group.sum_squares_cm2) for group in dataset.series]
    axis.bar([group.name.capitalize() for group in dataset.series], values, color=colors, width=.55)
    axis.set(title=title, ylabel='Within-species sum of squares (cm²)')
    axis.set_ylim(0, max(values) * 1.24)
    for index, value in enumerate(values):
        axis.text(index, value + max(values) * .03, f'{value:.4f}', ha='center')


def render_panels(dataset, output, panel_b_title):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    # A single style and physical size keep panels reusable across revisions.
    with plt.rc_context({'font.family': 'DejaVu Sans', 'font.size': 10,
                         'axes.spines.top': False, 'axes.spines.right': False,
                         'svg.fonttype': 'none', 'svg.hashsalt': 'pero-fisher-figure-v1',
                         'pdf.fonttype': 42, 'axes.labelsize': 10}):
        figure, axes = plt.subplots(1, 2, figsize=(6.8, 2.9), layout='constrained')
        colors = ('#0072B2', '#D55E00')
        panel_observations(axes[0], dataset, colors)
        panel_dispersion(axes[1], dataset, colors, panel_b_title)
        for label, axis in zip(('a', 'b'), axes):
            axis.text(-.16, 1.12, label, transform=axis.transAxes, fontsize=11, fontweight='bold')
        figure.savefig(output / 'figures/fisher.png', dpi=300, metadata={'Software': 'Pero publication example'})
        figure.savefig(output / 'figures/fisher.svg', metadata={'Date': None, 'Creator': 'Pero publication example'})
        figure.savefig(output / 'figures/fisher.pdf', metadata={'CreationDate': None, 'ModDate': None,
                                                       'Creator': 'Pero publication example'})
        plt.close(figure)
    return matplotlib.__version__


def generate(data_path, output, panel_b_title='Within-species dispersion'):
    dataset = FigureDataset.parse(data_path.read_bytes())
    # Refuse accidental replacement of a prior delivery; choose a new directory.
    output.mkdir(parents=True, exist_ok=False)
    for directory in ('figures', 'data', 'code'):
        (output / directory).mkdir()
    matplotlib_version = render_panels(dataset, output, panel_b_title)
    code = Path(__file__).read_bytes()
    code_sha = hashlib.sha256(code).hexdigest()
    total = sum(group.sum_squares_cm2 for group in dataset.series)
    original = dataset.status == 'reviewed-transcription'
    article = f'''---
title: Fisher Table I — a reproducible two-panel figure
authors:
  - name: Pero publication example
---

# Sepal-length measurements and dispersion

{{numref}}`fig-fisher` links the 100 frozen input measurements to their
within-species dispersion. The combined sum of squares is **{float(total):.4f}** cm²
(exact arithmetic: {total}). Both species have 50 observations.

```{{figure}} figures/fisher.png
:name: fig-fisher
:width: 100%

(a) All 100 Table I observations, with species distinguished by marker and color.
(b) Sum of squared deviations from each species' own mean, in cm².
```

The source is Fisher (1936), Table I, printed page 180.
DOI: 10.1111/j.1469-1809.1936.tb02137.x.
{'These bytes match Pero Paper’s reviewed visual transcription. The combined statistic matches Table III’s printed 19.1434 cm².' if original else 'This is an edited input variant. It is not the reviewed transcription and does not establish reproduction of Fisher’s reported statistic.'}
This authored figure checks software/data traceability; it is not new biological
evidence or independent scientific peer review.

The fixed source and per-panel inputs are retained in this snapshot:

- Measurements: `data/fisher_table1.csv`
- Editable generator: `code/figure.py`
- Panel sources: `publication-provenance.json`

The editable-text SVG is retained for download. The vector PDF is delivered
alongside the snapshot. Notebook embeds the 300 dpi PNG.
'''
    artifacts = []
    for filename, media_type in [('figures/fisher.png', 'image/png'), ('figures/fisher.svg', 'image/svg+xml'),
                                 ('figures/fisher.pdf', 'application/pdf')]:
        data = (output / filename).read_bytes()
        artifacts.append({'path': filename, 'mediaType': media_type,
                          'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    common = {'data': [{'path': 'data/fisher_table1.csv', 'sha256': dataset.sha256}]}
    manifest = {'format': 'pero-publication-provenance', 'version': 1,
                'source': {'doi': DOI, 'table': 'I', 'printedPage': 180,
                           'reviewedDataSha256': REVIEWED_SHA256, 'status': dataset.status},
                'figures': [{'id': 'fig-fisher', 'path': 'figures/fisher.png',
                             'sha256': artifacts[0]['sha256'], 'exports': ['figures/fisher.svg'],
                             'panels': [{'id': 'a', 'label': 'Observed sepal lengths', **common,
                                         'code': [{'path': 'code/figure.py', 'sha256': code_sha,
                                                   'locator': 'function panel_observations'}]},
                                        {'id': 'b', 'label': panel_b_title, **common,
                                         'code': [{'path': 'code/figure.py', 'sha256': code_sha,
                                                   'locator': 'function panel_dispersion'}]}]}],
                'statistics': {'totalSumSquaresCm2': str(total),
                               'species': [{'name': group.name, 'count': len(group.lengths_cm),
                                            'meanCm': str(group.mean_cm),
                                            'sumSquaresCm2': str(group.sum_squares_cm2)}
                                           for group in dataset.series]},
                'environment': {'python': platform.python_version(), 'matplotlib': matplotlib_version},
                'command': ['python', 'code/figure.py', '--data', 'data/fisher_table1.csv', '--output', 'next-delivery',
                            '--panel-b-title', panel_b_title], 'artifacts': artifacts}
    files = [{'path': 'article.md', 'text': article}, {'path': 'data/fisher_table1.csv', 'text': dataset.source},
             {'path': 'code/figure.py', 'text': code.decode('utf-8')},
             {'path': 'publication-provenance.json', 'text': json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'}]
    assets = [{'path': item['path'], 'mediaType': item['mediaType'],
               'base64': base64.b64encode((output / item['path']).read_bytes()).decode('ascii')}
              for item in artifacts if item['mediaType'] != 'application/pdf']
    snapshot = {'format': 'pero-myst-project', 'version': 2, 'entry': 'article.md',
                'files': files, 'assets': assets}
    for resource in files:
        (output / resource['path']).write_text(resource['text'], encoding='utf-8')
    project = output / 'fisher.myst-project.json'
    project.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'project': str(project.resolve()), 'dataSha256': dataset.sha256,
            'datasetStatus': dataset.status, 'totalSumSquaresCm2': str(total), 'artifacts': artifacts}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=DATA, help='Complete 100-row CSV; default: reviewed Fisher transcription')
    parser.add_argument('--output', type=Path, required=True, help='New directory, kept separate for each delivery')
    parser.add_argument('--panel-b-title', default='Within-species dispersion', help='Targeted panel b presentation change')
    args = parser.parse_args()
    try:
        print(json.dumps(generate(args.data, args.output, args.panel_b_title), indent=2))
    except (ValueError, FileExistsError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
