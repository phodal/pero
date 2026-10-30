import React from 'react';

export function Feedback({ kind, children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement> & { kind?: 'error' }) {
  return <div {...props} className={`pero-ui-feedback ${kind ?? ''} ${className}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}
