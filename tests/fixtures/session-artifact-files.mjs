// Deterministic synthetic deliveries shared by Host/MCP and Native acceptance.
// These bytes demonstrate rendering and retention, never scientific validation.
import { deflateSync } from 'node:zlib';

function png(revision) {
  const width = 320, height = 160;
  const pixels = Buffer.alloc(height * (1 + width * 3), 255);
  for (let y = 0; y < height; y++) {
    pixels[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x++) {
      const curve = height - 24 - Math.round((x - 24) * (revision === 1 ? 0.3 : 0.2));
      const axis = x === 24 && y >= 20 && y <= height - 24 || y === height - 24 && x >= 24 && x < width - 20;
      const mark = x >= 24 && x < width - 20 && Math.abs(y - curve) <= 2;
      if (axis || mark) {
        const at = y * (1 + width * 3) + 1 + x * 3;
        pixels.set(mark ? [20, 120, 115] : [80, 80, 80], at);
      }
    }
  }
  const chunk = (kind, data) => {
    const type = Buffer.from(kind), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([type, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

function pdf(revision) {
  const stream = `BT /F1 18 Tf 48 730 Td (Synthetic artifact evidence) Tj 0 -32 Td /F1 12 Tf (Revision ${revision}. Unverified; no experiment was performed.) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}

export function richArtifactFiles(revision = 1) {
  const value = revision === 1 ? 7 : 9;
  return [
    { name: 'analysis.py', title: '合成分析代码', mediaType: 'text/x-python', data: Buffer.from(`# Synthetic fixture; not executed.\nvalues = [2, ${value}, 4]\nprint(sum(values))\n`) },
    { name: 'results.csv', title: '合成数据表', mediaType: 'text/csv', data: Buffer.from(`sample,value,note\nA,${value},synthetic\nB,4,"unverified, fixture"\n`) },
    { name: 'chart.svg', title: '合成 SVG 图', mediaType: 'image/svg+xml', data: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240"><rect width="480" height="240" fill="white"/><text x="24" y="32" fill="#222" font-family="sans-serif" font-size="18">Synthetic data - revision ${revision}</text><path d="M40 60V200H450" fill="none" stroke="#555"/><path d="M40 180L160 ${value === 7 ? 100 : 80}L280 145L430 70" fill="none" stroke="#147873" stroke-width="4"/><text x="24" y="228" fill="#555" font-family="sans-serif" font-size="14">Unverified fixture; no scientific experiment</text></svg>`) },
    { name: 'chart.png', title: '合成 PNG 图', mediaType: 'image/png', data: png(revision) },
    { name: 'report.html', title: '合成 HTML 报告', mediaType: 'text/html', data: Buffer.from(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic artifact</title><style>body{font:16px system-ui;padding:24px;color:#222;background:#fff}table{border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ccc}</style><h1>Synthetic report ${revision}</h1><p>Unverified fixture. No experiment was performed.</p><table><tr><th>Sample</th><th>Value</th></tr><tr><td>A</td><td>${value}</td></tr></table><p id="script-state">Scripts did not run.</p><script>document.getElementById('script-state').textContent='SCRIPT EXECUTED';</script></html>`) },
    { name: 'evidence.pdf', title: '合成 PDF 证据', mediaType: 'application/pdf', data: pdf(revision) },
    { name: 'analysis.ipynb', title: '合成 Notebook', mediaType: 'application/x-ipynb+json', data: Buffer.from(JSON.stringify({ nbformat: 4, nbformat_minor: 5,
      metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } }, cells: [
        { id: 'notice', cell_type: 'markdown', metadata: {}, source: ['Synthetic analysis notebook · example inputs.'] },
        { id: 'result', cell_type: 'code', execution_count: 1, metadata: {}, source: [`value = ${value}\n`, 'value'], outputs: [{ output_type: 'execute_result', execution_count: 1, metadata: {}, data: { 'text/plain': [String(value)] } }] },
      ] })) },
  ];
}
