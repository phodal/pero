export type BrowserDialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload';

export type BrowserDialog = {
  id: string;
  type: BrowserDialogType;
  message: string;
};

export type BrowserDialogAnswer = {
  dialogId: string;
  decision: 'accept' | 'dismiss';
  promptText?: string;
};

export function dialogRefusal(dialog: BrowserDialog | undefined, answer: BrowserDialogAnswer): string | undefined {
  if (dialog?.id !== answer.dialogId) return 'The JavaScript dialog is no longer active. Read the dialog again.';
  if (answer.decision === 'accept' && (dialog.type === 'alert' || dialog.type === 'beforeunload'))
    return 'This JavaScript dialog can only be dismissed.';
  const acceptsPrompt = dialog.type === 'prompt' && answer.decision === 'accept';
  if (acceptsPrompt && answer.promptText === undefined) return 'Enter promptText to accept this prompt.';
  if (!acceptsPrompt && answer.promptText !== undefined) return 'promptText is only valid when accepting a prompt.';
}
