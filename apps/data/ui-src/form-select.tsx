import { useState } from 'react';
import { Select, type SelectProps } from '@pero/app-sdk/ui';

/** SDK Select is controlled; this keeps an uncontrolled form field's draft local and submits it by name. */
export function FormSelect({ defaultValue, ...props }: Omit<SelectProps, 'value' | 'onChange'> & { name: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  return <Select {...props} value={value} onChange={setValue} />;
}
