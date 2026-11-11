import katex from 'katex';
import { xml2js, type Element } from 'xml-js';
import { Math as DocxMath, MathRun, MathFraction, MathRadical, MathSubScript, MathSuperScript, MathSubSuperScript } from 'docx';
import { inertPublicationMath } from './myst-publication.ts';
type MathChild = ConstructorParameters<typeof DocxMath>[0]['children'][number];
export function nativeDocxMath(source: string): { status: 'native'; children: MathChild[]; warnings: string[] } | { status: 'literal'; reason: string } {
  if (!inertPublicationMath(source)) return { status: 'literal', reason: 'unsupported math command' };
  const warnings = new Set<string>();
  try {
    // Parse only trusted KaTeX-generated XML, never authored XML/DTD/entities.
    const output = katex.renderToString(source, { output: 'mathml', trust: false, strict: 'error', throwOnError: true, maxExpand: 1000, maxSize: 20 });
    const tree = xml2js(output, { compact: false }) as Element;
    const elems = (n: Element) => (n.elements ?? []).filter(e => e.type === 'element');
    const text = (n: Element): string => n.type === 'text' ? String(n.text ?? '') : (n.elements ?? []).map(text).join('');
    const convert = (n: Element): MathChild[] => {
      const kids = elems(n), child = (i: number) => { if (!kids[i]) throw new Error('missing MathML operand'); return convert(kids[i]); };
      if (n.attributes?.mathvariant || n.name === 'mtext' || n.name === 'mstyle') warnings.add('Math font/style normalized to native equation defaults.');
      switch (n.name) {
        case 'span': case 'math': case 'mrow': case 'mstyle': return kids.flatMap(convert);
        case 'semantics': return child(0);
        case 'annotation': return [];
        case 'mi': case 'mn': case 'mo': case 'mtext':
          if (n.attributes?.stretchy) warnings.add('Stretchy delimiter sizing normalized.');
          return [new MathRun(text(n))];
        case 'mspace': warnings.add('Math spacing normalized.'); return [new MathRun(' ')];
        case 'msup': return [new MathSuperScript({ children: child(0), superScript: child(1) })];
        case 'msub': return [new MathSubScript({ children: child(0), subScript: child(1) })];
        case 'msubsup': return [new MathSubSuperScript({ children: child(0), subScript: child(1), superScript: child(2) })];
        case 'mfrac': return [new MathFraction({ numerator: child(0), denominator: child(1) })];
        case 'msqrt': return [new MathRadical({ children: kids.flatMap(convert) })];
        case 'mroot': return [new MathRadical({ children: child(0), degree: child(1) })];
        default: throw new Error(`unsupported MathML element ${n.name}`);
      }
    };
    return { status: 'native', children: elems(tree).flatMap(convert), warnings: [...warnings] };
  } catch (error) { return { status: 'literal', reason: error instanceof Error ? error.message : 'unsupported equation' }; }
}
