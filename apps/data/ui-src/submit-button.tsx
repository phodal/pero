import type { ComponentProps } from 'react';
import { Button } from '@pero/app-sdk/ui';

/**
 * Desktop embeds Apps in a sandbox without `allow-forms`, so native form
 * submission (and its `submit` event) never happens there. Validate natively,
 * then deliver a cancelable submit event to the existing onSubmit owner.
 */
export function SubmitButton(props: Omit<ComponentProps<typeof Button>, 'type' | 'onClick'>) {
  return <Button {...props} type="button" onClick={event => {
    const form = event.currentTarget.form;
    if (form?.reportValidity()) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }} />;
}
