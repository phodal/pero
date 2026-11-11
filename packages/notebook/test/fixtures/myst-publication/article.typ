#let tablex(columns: 1, header-rows: 0, repeat-header: true, ..args) = table(columns: columns, ..args)
#let tableStyle = (:)
#let columnStyle = (:)
= Scientific publication

Ada Example DOI: 10.1234/example

A real formula $x^2$ and equation:

$ N = N_0 e^(r t) + frac(x^2, sqrt(y)) $
\[Image: Figure\]

#tablex(columns: 2, header-rows: 1, repeat-header: true, ..tableStyle, ..columnStyle,
[
Trial
],
[
Result
],
[
A
],
[
42
],
)
- First
- Second

== Discussion

A *bold* finding.
// PERO PUBLICATION LOSSES ["Image not embedded in typst: figure.png","Full frontmatter and exact source retained in source record; only title, author names and DOI projected into document metadata."]
// PERO ORIGINAL SOURCE JSON {"format":"pero-myst","version":1,"source":"---\ntitle: Scientific publication\nauthors:\n  - name: Ada Example\ndoi: 10.1234/example\n---\n# Scientific publication\n\nA real formula $x^2$ and equation:\n\n$$\nN = N_0 e^{rt} + \\frac{x^2}{\\sqrt{y}}\n$$\n\n![Figure](figure.png)\n\n| Trial | Result |\n| --- | --- |\n| A | 42 |\n\n- First\n- Second\n\n## Discussion\n\nA **bold** finding.\n"}
