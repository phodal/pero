import { Disclosure, Feedback } from '@pero/app-sdk/ui';

const copy = {
  zh: {
    credential: '请先配置 Agent 的 API Key',
    credentialHint: '在设置 → 模型与 Agent 中填写 API Key，保存后重试。工作记录会保留。',
    records: '暂时无法读取工作记录。请重试。',
    generation: '简报暂时未能生成。请重试，或查看生成会话。',
    action: '暂时无法打开此内容，请重试。',
    research: '暂时无法读取研究检查，请重试。',
    retained: '下方保留上次生成的简报。',
    details: '技术详情',
  },
  en: {
    credential: 'Add an API key for your Agent',
    credentialHint: 'Add an API key in Settings → Models & Agents, save it, then retry. Your work records are kept.',
    records: 'Work records could not be loaded. Please retry.',
    generation: 'The brief could not be generated. Please retry or open the generation session.',
    action: 'This content could not be opened. Please retry.',
    research: 'Research checks could not be loaded. Please retry.',
    retained: 'The previous brief remains below.',
    details: 'Technical details',
  },
};

/** Translate the actionable prerequisite here; other Host diagnostics stay secondary. */
export function InsightsError({ error, locale, context = 'generation', retained }: {
  error: string; locale: 'zh' | 'en'; context?: 'records' | 'generation' | 'action' | 'research'; retained?: boolean;
}) {
  const t = copy[locale];
  const credential = context === 'generation' && /\bchat\.credential_required\b/.test(error);
  return <div className="point-insights-error">
    <Feedback kind={credential ? 'warning' : 'error'} variant="block">
      {credential ? <><strong>{t.credential}</strong><span className="point-insights-error-hint">{t.credentialHint}</span></> : t[context]}
      {retained && <span className="point-insights-error-hint">{t.retained}</span>}
    </Feedback>
    {!credential && <Disclosure variant="inline" className="point-insights-diagnostics" summary={<>{t.details}</>}><pre>{error.slice(0, 1000)}</pre></Disclosure>}
  </div>;
}
