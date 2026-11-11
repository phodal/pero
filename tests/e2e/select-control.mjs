const valuePattern = /^[A-Za-z0-9._:-]+$/;

function triggerFor(scope, label) {
  return scope.getByRole('button', { name: label, exact: true });
}

/** Pero Select is a button that opens a listbox. Options carry their value on data-value. */
export async function chooseSelect(scope, label, value) {
  if (!valuePattern.test(value)) throw new Error(`Refusing to select an unexpected value: ${value}`);
  const trigger = triggerFor(scope, label);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await scope.getByRole('listbox', { name: label, exact: true }).locator(`[role="option"][data-value="${value}"]`).click();
  if (await trigger.getAttribute('data-value') !== value) throw new Error(`Select ${label} did not keep ${value}`);
  if (await trigger.getAttribute('aria-expanded') !== 'false') throw new Error(`Select ${label} stayed open`);
}

export async function expectSelectOptionCount(scope, label, count) {
  const trigger = triggerFor(scope, label);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const actual = await scope.getByRole('listbox', { name: label, exact: true }).getByRole('option').count();
  if (actual !== count) throw new Error(`${label} lists ${actual} options, expected ${count}`);
}
