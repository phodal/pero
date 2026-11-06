import type { ComponentProps } from 'react';
import { Button } from '@pero/app-sdk/ui';

/**
 * Desktop embeds Apps in a sandbox without `allow-forms`, so native form
 * submission (and its `submit` event) never happens there. Validate natively,
 * then deliver a cancelable submit event to the existing onSubmit owner.
 */
export function SubmitButton(props: Omit<ComponentProps<typeof Button>, 'type' | 'onClick'>) {
  return <Button {...props} data-submit type="button" onClick={event => {
    const form = event.currentTarget.form;
    if (form?.reportValidity()) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }} />;
}

/** Route implicit submission through the same validated button path. */
export function DataForm(props: Omit<ComponentProps<'form'>, 'onKeyDown'>) {
  return <form {...props} onKeyDown={event => {
    if (event.defaultPrevented || event.key !== 'Enter' || event.nativeEvent.isComposing
      || event.nativeEvent.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.form !== event.currentTarget
      || !['text', 'search', 'email', 'tel', 'url', 'password', 'number'].includes(input.type)) return;
    // Cancel native implicit submission, including key repeat, before clicking.
    event.preventDefault();
    if (!event.repeat) Array.from(event.currentTarget.elements)
      .find((control): control is HTMLButtonElement => control instanceof HTMLButtonElement && control.hasAttribute('data-submit'))?.click();
  }} />;
}
