import { readFileSync, writeFileSync } from 'node:fs';

// Editorial SVG language from openpero-research-roadmap.svg (de4927f).
// Documentation illustrations only: this is not a second product UI theme.
export const ink = '#20272B';
export const muted = '#667075';
export const border = '#D7DCDF';
export const soft = '#F5F7F7';
export const warm = '#A87531';
export const wash = '#FBF3E7';
const escape = (value) => String(value).replace(/[&<>"']/g, (v) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[v]);

export class Graphic {
  constructor(width, height, lang, title, description) {
    this.parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description" xml:lang="${lang}">`,
      `<title id="title">${escape(title)}</title>`,
      `<desc id="description">${escape(description)}</desc>`,
      '<defs>',
      ...[muted, warm].map((color, i) => `<marker id="arrow${i}" markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M 2 2 L 9 6 L 2 10" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker>`),
      '</defs>',
      '<style>text{font-family:"Noto Sans CJK SC","Noto Sans CJK","PingFang SC","Microsoft YaHei",Arial,sans-serif}path,line,rect,circle,ellipse{stroke-linecap:round;stroke-linejoin:round}</style>',
      `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`,
    ];
  }
  add(value) { this.parts.push(value); }
  text(x, y, value, size = 24, color = ink, weight = 400, anchor = 'start') {
    this.add(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${escape(value)}</text>`);
  }
  lines(x, y, values, size = 24, color = muted, anchor = 'middle', step = 33) {
    values.forEach((value, i) => this.text(x, y + i * step, value, size, color, 400, anchor));
  }
  rect(x, y, width, height, { fill = '#FFFFFF', stroke = ink, radius = 8, dashed = false, weight = 2 } = {}) {
    this.add(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${weight}"${dashed ? ' stroke-dasharray="7 6"' : ''}/>`);
  }
  path(d, { color = muted, weight = 2.2, dashed = false, arrow = false, fill = 'none' } = {}) {
    this.add(`<path d="${d}" fill="${fill}" stroke="${color}" stroke-width="${weight}"${dashed ? ' stroke-dasharray="7 6"' : ''}${arrow ? ` marker-end="url(#arrow${color === warm ? 1 : 0})"` : ''}/>`);
  }
  circle(x, y, r, { fill = '#FFFFFF', stroke = ink, weight = 2.4 } = {}) {
    this.add(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${weight}"/>`);
  }
  halo(x, y, rx, ry, accent = false) {
    this.add(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${accent ? wash : soft}"/>`);
  }
  // Line illustrations, deliberately distinct from interactive UI icons.
  illustration(kind, x, y, scale = 1, accent = false) {
    const color = accent ? warm : ink;
    this.add(`<g transform="translate(${x} ${y}) scale(${scale})">`);
    if (kind === 'paper' || kind === 'check' || kind === 'contract') {
      this.path('M -44 -62 H 21 L 45 -38 V 62 H -44 Z M 21 -62 V -38 H 45', { color, fill: '#FFFFFF', weight: 2.8 });
      this.path('M -28 -40 H 8', { color, weight: 4 });
      this.path('M -28 -23 H 25 M -28 -9 H 25 M -28 5 H 13', { color: border });
      if (kind === 'check') {
        this.circle(23, 39, 26, { stroke: color });
        this.path('M 9 39 L 19 49 L 38 28', { color, weight: 3 });
      } else if (kind === 'contract') {
        [22, 40].forEach(cy => {
          this.rect(-28, cy - 6, 10, 10, { stroke: muted, radius: 1 });
          this.path(`M -8 ${cy} H 27`, { color: muted });
        });
      } else {
        this.path('M -28 44 V 21 M -28 44 H 28 M -19 35 H -7 M 0 26 H 12 M 17 36 H 27', { color: muted });
      }
    } else if (kind === 'laptop') {
      this.rect(-65, -47, 130, 87, { stroke: color, weight: 2.8 });
      this.rect(-54, -35, 108, 62, { stroke: 'none', fill: soft, radius: 2 });
      this.path('M -65 40 L -80 54 H 80 L 65 40 M -21 47 H 21', { color, weight: 2.8 });
      this.path('M -25 -13 L -38 0 L -25 13 M 25 -13 L 38 0 L 25 13 M 7 -21 L -7 22', { color: muted, weight: 2.6 });
    } else if (kind === 'people') {
      [[-35, 0], [34, 9]].forEach(([cx, cy]) => {
        this.circle(cx, cy - 28, 14, { stroke: color });
        this.path(`M ${cx - 23} ${cy + 22} V ${cy + 6} C ${cx - 23} ${cy - 15} ${cx + 23} ${cy - 15} ${cx + 23} ${cy + 6} V ${cy + 22} Z`, { color, fill: '#FFFFFF', weight: 2.8 });
      });
    } else if (kind === 'folder') {
      this.path('M -61 -45 H -18 L -5 -31 H 62 V 51 H -61 Z M -61 -20 H 62', { color, fill: '#FFFFFF', weight: 2.8 });
      this.path('M -37 5 L 0 26 L 38 3 M 0 26 L 35 43', { color: muted });
      [[-37, 5], [0, 26], [38, 3], [35, 43]].forEach(([cx, cy]) => this.circle(cx, cy, 6, { stroke: color }));
    } else if (kind === 'server') {
      [-38, 1].forEach((cy) => {
        this.rect(-52, cy, 104, 30, { stroke: color, weight: 2.8, radius: 5 });
        this.circle(-36, cy + 15, 3, { fill: color, stroke: 'none' });
        this.path(`M -20 ${cy + 15} H 32`, { color: border });
      });
      this.path('M 0 32 V 49 M -37 49 H 37', { color: muted });
    } else if (kind === 'app') {
      this.rect(-62, -47, 124, 96, { stroke: color, weight: 2.8 });
      this.path('M -62 -24 H 62', { color });
      [-47, -36, -25].forEach(cx => this.circle(cx, -35, 2.3, { fill: muted, stroke: 'none' }));
      this.rect(-48, -11, 31, 45, { stroke: border, fill: soft, radius: 2 });
      this.path('M -2 -8 H 45 M -2 6 H 35 M -2 20 H 45 M -2 34 H 26', { color: muted });
    } else if (kind === 'plugin') {
      this.path('M -42 -36 H -12 V -45 C -12 -65 13 -65 13 -45 V -36 H 42 V -8 H 50 C 70 -8 70 17 50 17 H 42 V 46 H -42 Z', { color, fill: '#FFFFFF', weight: 2.8 });
      this.path('M -25 7 H 10 M -25 21 H 20', { color: muted });
    } else if (kind === 'database') {
      this.path('M -36 -29 V 35 C -36 53 36 53 36 35 V -29', { color, fill: '#FFFFFF', weight: 2.8 });
      this.add(`<ellipse cx="0" cy="-29" rx="36" ry="13" fill="#FFFFFF" stroke="${color}" stroke-width="2.8"/>`);
      this.path('M -36 -8 C -36 10 36 10 36 -8 M -36 14 C -36 32 36 32 36 14', { color });
    } else if (kind === 'lock') {
      this.rect(-28, -6, 56, 48, { stroke: color, weight: 2.8 });
      this.path('M -18 -6 V -28 C -18 -51 18 -51 18 -28 V -6', { color, weight: 2.8 });
      this.circle(0, 13, 4, { fill: color, stroke: 'none' });
      this.path('M 0 17 V 27', { color, weight: 2.8 });
    }
    this.add('</g>');
  }
  save(file) {
    const output = new URL(`../../docs/assets/${file}`, import.meta.url);
    const svg = `${this.parts.join('\n')}\n</svg>\n`;
    if (process.argv.includes('--check')) {
      if (readFileSync(output, 'utf8') !== svg) throw new Error(`Regenerate ${file}`);
    } else {
      writeFileSync(output, svg);
      console.log(`Generated ${output.pathname}`);
    }
  }
}
