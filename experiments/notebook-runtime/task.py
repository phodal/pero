"""One authored CSV task shared verbatim by both candidate runtimes.

Values are synthetic engineering inputs, not experimental measurements.
The fixed expected result in run.py is checked separately from this calculation.
"""
from textwrap import indent

LOAD = '''import csv
import json
from fractions import Fraction
from pathlib import Path
rows = list(csv.DictReader(Path("input.csv").open(newline="")))
assert len(rows) == 6 and len({r["sample"] for r in rows}) == 6
assert {r["group"] for r in rows} == {"control", "treatment"}
'''
COMPUTE = '''groups = {name: [Fraction(r["concentration_mg_l"]) for r in rows if r["group"] == name]
          for name in ("control", "treatment")}
summary = {name: {"n": len(values), "mean_mg_l": str(sum(values) / len(values))}
           for name, values in groups.items()}
table_html = ('<h1>Authored CSV runtime fixture</h1><p>Synthetic inputs; not scientific evidence.</p>'
              '<table><thead><tr><th>Group</th><th>Count</th><th>Mean (mg/L)</th></tr></thead><tbody>'
              + ''.join(f'<tr><td>{name}</td><td>{value["n"]}</td><td>{value["mean_mg_l"]}</td></tr>'
                        for name, value in summary.items()) + '</tbody></table>')
'''
SAVE = '''Path("result.json").write_text(json.dumps(summary, sort_keys=True) + "\\n")
Path("table.html").write_text(table_html)
print(json.dumps(summary, sort_keys=True))
'''
CELLS = (LOAD, COMPUTE, SAVE)


def marimo_source():
    """Use upstream native source syntax; leave its DAG to marimo."""
    source = 'import marimo\n\n__generated_with = "0.25.2"\napp = marimo.App()\n'
    for arguments, code, definitions in (
        ('', LOAD, 'Fraction, Path, json, rows'),
        ('Fraction, rows', COMPUTE, 'summary, table_html'),
        ('Path, json, summary, table_html', SAVE + 'import marimo as mo\nmo.Html(table_html)\n', ''),
    ):
        source += f'\n@app.cell\ndef _({arguments}):\n' + indent(code, '    ')
        source += f'    return {definitions}\n'
    return source + '\nif __name__ == "__main__":\n    app.run()\n'
