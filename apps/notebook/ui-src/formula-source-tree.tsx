import { useAppI18n } from '@pero/app-sdk';
import { Disclosure, Feedback } from '@pero/app-sdk/ui';
import type { FormulaSyntax } from '@pero/notebook/formula-syntax';

const messages = {
  title: { en: 'Source syntax tree', zh: '源码语法树' },
  scope: { en: 'Original source AST built from engine tokens. It records operators and precedence, calls, references, ranges, unions, intersections and constant arrays. It does not evaluate expressions or claim the engine exposes an AST. Named/structured/external references and special reference-function tokens are unsupported. Calculated values and dependencies above come from the actual engine.', zh: '根据引擎词元构建的原创源码 AST，记录运算符及优先级、函数调用、引用、区域、并集、交集和常量数组。它不执行计算，也不声称引擎提供 AST。不支持命名/结构化/外部引用及特殊引用函数词元。上方的计算值和依赖来自实际引擎。' },
};
export function FormulaSourceTree({ syntax }: { syntax: FormulaSyntax }) {
  const { t } = useAppI18n(messages);
  return <Disclosure summary={t('title')}>
    <p className="notebook-note">{t('scope')}</p>
    {syntax.sourceAst.status === 'supported' ? <pre className="notebook-science-json">{JSON.stringify(syntax.sourceAst.root, null, 2)}</pre> :
      <Feedback kind={syntax.sourceAst.status === 'invalid' ? 'error' : 'info'}>{syntax.sourceAst.detail}</Feedback>}
  </Disclosure>;
}
