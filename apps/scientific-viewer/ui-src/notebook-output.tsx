import React from 'react';

type CellOutput = { output_type?: string; text?: string | string[]; traceback?: string[]; data?: Record<string, string | string[]> };

export function NotebookOutput({ outputs, zh }: { outputs: unknown[]; zh: boolean }) {
  if (!outputs.length) return null;
  return <div className="notebook-live-output" aria-label={zh ? '单元输出' : 'Cell output'}
    data-error={outputs.some(value => (value as CellOutput)?.output_type === 'error') || undefined}>
    <div className="notebook-output-label">{zh ? '输出' : 'Output'}</div>
    {outputs.map((value, offset) => {
      const output = value as CellOutput;
      const image = output?.data?.['image/png'];
      const png = Array.isArray(image) ? image.join('') : image;
      const imageShown = typeof png === 'string' && /^[a-z0-9+/=\s]+$/i.test(png);
      const text = output?.text ?? output?.traceback?.join('\n') ?? (imageShown ? undefined : output?.data?.['text/plain']);
      return <React.Fragment key={offset}>
        {imageShown && <img src={`data:image/png;base64,${png}`} alt={zh ? '单元图像输出' : 'Cell image output'} />}
        {text != null && <pre>{Array.isArray(text) ? text.join('') : text}</pre>}
      </React.Fragment>;
    })}
  </div>;
}
