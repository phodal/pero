/** Independently authored CC0 synthetic fixtures, not measurements or Point copies. */
export const examples = [
  { name: 'temperature.csv', text: 'time[s],temperature[C]\n0,20\n1,21\n2,23\n3,22\n' },
  { name: 'voltage-gaps.csv', text: 'time[s],voltage[V]\n0,4.2\n1,\n2,3.9\n' },
  { name: 'infrared.csv', text: 'wavenumber[cm-1],absorbance\n500,0.1\n1000,0.6\n1500,0.2\n2000,0.9\n' },
  { name: 'diffraction.csv', text: '2theta[deg],intensity\n10,1\n20,8\n30,2\n40,12\n' },
  { name: 'uv-visible.csv', text: 'wavelength[nm],absorbance\n300,0.2\n400,0.8\n500,0.4\n600,0.1\n' },
  { name: 'invalid-spectrum.csv', text: 'frequency[Hz],amplitude\n0,1\n1,bad\n2,\n3,0.5\n' },
  { name: 'quoted-table.csv', text: 'sample,note\n"sample, one","two ""quotes"""\nsecond,plain\n' },
  { name: 'water.pdb', text: 'HEADER    SYNTHETIC WATER\nHETATM    1  O   HOH A   1       0.000   0.000   0.000  1.00 20.00           O\nHETATM    2  H1  HOH A   1       0.957   0.000   0.000  1.00 20.00           H\nHETATM    3  H2  HOH A   1      -0.240   0.927   0.000  1.00 20.00           H\nEND\n' },
  { name: 'solvents.smi', text: 'O\nCCO\nCC(=O)C\n' },
  { name: 'invalid-molecules.smi', text: 'CCO\nnot-a-smiles\n' },
  { name: 'model-metadata.json', text: JSON.stringify({ kind: 'model-metadata', architecture: 'synthetic-demo', weights: 'not supplied', license: 'CC0-1.0', verified: false }) },
  { name: 'sample.pdf', text: pdf() },
  { name: 'demo.ipynb', text: notebook() },
];
function notebook() {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', mimetype: 'text/x-python', file_extension: '.py' },
    },
    cells: [
      {
        id: 'md-intro',
        cell_type: 'markdown',
        metadata: {},
        source: ['# Synthetic notebook\n', '\n', 'CC0-1.0 fixture for Scientific Viewer. Stored outputs only; no kernel is started.\n'],
      },
      {
        id: 'code-sum',
        cell_type: 'code',
        metadata: {},
        execution_count: 1,
        source: ['values = [20, 21, 23, 22]\n', 'print(sum(values) / len(values))\n'],
        outputs: [
          { output_type: 'stream', name: 'stdout', text: ['21.5\n'] },
        ],
      },
      {
        id: 'code-table',
        cell_type: 'code',
        metadata: {},
        execution_count: 2,
        source: ['from IPython.display import Markdown\n', 'Markdown("| time[s] | temperature[C] |\\n| --- | --- |\\n| 0 | 20 |\\n| 1 | 21 |")\n'],
        outputs: [
          {
            output_type: 'display_data',
            metadata: {},
            data: {
              'text/plain': ['<IPython.core.display.Markdown object>'],
              'text/markdown': ['| time[s] | temperature[C] |\n| --- | --- |\n| 0 | 20 |\n| 1 | 21 |'],
            },
          },
        ],
      },
    ],
  });
}
function pdf() {
  const stream = 'BT /F1 18 Tf 40 120 Td (Synthetic scientific evidence.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = text.length;
  return text + `xref\n0 6\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
