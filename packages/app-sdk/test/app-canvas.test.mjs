import test from "node:test";
import assert from "node:assert/strict";
import { createUiRuntime } from "./ui-test-runtime.mjs";

const source = {
  entryId: "a".repeat(32),
  revision: 2,
  blockId: "block",
  readOnly: false,
  binding: {
    id: "binding",
    app: "data",
    panel: "main",
    view: "dataset-inspector",
    declaration: "b".repeat(64),
    inputs: { datasetId: "ds-" + "c".repeat(32) },
  },
};
const projection = {
  title: "Actual dataset",
  fields: [{ label: "Dataset", value: source.binding.inputs.datasetId }],
  columns: ["SHA-256"],
  rows: [["d".repeat(64)]],
  notice: "",
  actions: [
    {
      name: "canvas-archive",
      label: "Archive dataset",
      params: { archived: true },
    },
  ],
};

test("declared view renders owner data and routes one explicitly confirmed action with its returned receipt", async (t) => {
  const env = await createUiRuntime(t, {
    contents:
      "export { DeclaredAppCanvas } from './app-canvas'; export { AppSdkProvider, createAppHost } from './host';",
    resolveDir: new URL("../src", import.meta.url).pathname,
  });
  const { ui, React, render, click } = env;
  const calls = [],
    receipts = [];
  let finish;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/host/canvas");
    const input = JSON.parse(init.body);
    calls.push(input);
    if (input.operation === "mount" || input.operation === "read")
      return Response.json({ instance: "actual-instance", source, projection });
    if (input.operation === "act")
      return new Promise((resolve) => {
        finish = (value) => resolve(Response.json(value));
      });
    if (input.operation === "cancel") {
      finish({ state: "cancelled" });
      return Response.json({ state: "cancelled" });
    }
    return Response.json({ state: "released" });
  });
  const mount = (value = source, active = true) =>
    render(
      React.createElement(
        ui.AppSdkProvider,
        { host: ui.createAppHost({ name: "Notebook", active }) },
        React.createElement(ui.DeclaredAppCanvas, {
          source: value,
          onResult: (value) => receipts.push(value),
        }),
      ),
    );
  const button = (name) =>
    [...document.querySelectorAll("button")].find(
      (button) => button.textContent === name,
    );
  await mount();
  assert.match(document.body.textContent, /Actual dataset/);
  assert.match(document.body.textContent, /dddddddd/);
  assert.equal(document.querySelector("iframe"), null);
  await click(button("Archive dataset"));
  await click(button("Archive dataset"));
  assert.equal(calls.filter((call) => call.operation === "act").length, 1);
  const receipt = {
    operationId: calls.find((call) => call.operation === "act").operationId,
    app: "data",
    result: { status: "completed", dataset: { archived: true } },
  };
  await React.act(async () => finish({ state: "completed", receipt }));
  assert.match(document.body.textContent, /not independent verification/);
  await click(button("Keep returned result in notebook"));
  assert.deepEqual(receipts, [receipt]);
  await click(button("Archive dataset"));
  await click(button("Cancel pending action"));
  assert.match(document.body.textContent, /cancelled before execution/);
  await mount({ ...source, readOnly: true });
  assert.equal(button("Archive dataset"), undefined);
  assert.match(
    document.body.textContent,
    /Actions are unavailable in this instance/,
  );
  await mount({ ...source, readOnly: true }, false);
  assert.ok(calls.some((call) => call.operation === "release"));
});

test("late mount replies release their exact instance after removal; two bindings do not share identity", async (t) => {
  const env = await createUiRuntime(t, {
    contents:
      "export { DeclaredAppCanvas } from './app-canvas'; export { AppSdkProvider, createAppHost } from './host';",
    resolveDir: new URL("../src", import.meta.url).pathname,
  });
  const { ui, React, render } = env;
  const calls = [],
    mounts = [];
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    const input = JSON.parse(init.body);
    calls.push(input);
    return input.operation === "mount"
      ? new Promise((resolve) =>
          mounts.push(() =>
            resolve(
              Response.json({
                instance: input.source.binding.id,
                source: input.source,
                projection,
              }),
            ),
          ),
        )
      : Response.json({ state: "released" });
  });
  await render(
    React.createElement(
      ui.AppSdkProvider,
      { host: ui.createAppHost({ name: "Notebook", active: true }) },
      React.createElement(
        React.Fragment,
        null,
        ...["one", "two"].map((id) =>
          React.createElement(ui.DeclaredAppCanvas, {
            key: id,
            source: { ...source, binding: { ...source.binding, id } },
          }),
        ),
      ),
    ),
  );
  await render(null);
  await React.act(async () => {
    for (const finish of mounts) finish();
  });
  assert.deepEqual(
    calls
      .filter((call) => call.operation === "release")
      .map((call) => call.instance)
      .sort(),
    ["one", "two"],
  );
  assert.equal(document.querySelector("section"), null);
});

test("remount can inspect durable unknown operations in readonly mode without dispatching again", async (t) => {
  const env = await createUiRuntime(t, {
    contents:
      "export { DeclaredAppCanvas } from './app-canvas'; export { AppSdkProvider, createAppHost } from './host';",
    resolveDir: new URL("../src", import.meta.url).pathname,
  });
  const { ui, React, render, click } = env;
  const calls = [];
  const receipt = {
    operationId: "old-operation",
    revision: 1,
    app: "data",
    inputDigest: "a".repeat(64),
    result: { status: "completed" },
  };
  t.mock.method(globalThis, "fetch", async (_path, init) => {
    const input = JSON.parse(init.body);
    calls.push(input);
    if (input.operation === "mount")
      return Response.json({
        instance: "recovered-instance",
        source,
        projection,
        history: [
          {
            operationId: "old-operation",
            action: "canvas-archive",
            state: "outcome-unknown",
          },
        ],
      });
    if (input.operation === "status") {
      assert.equal(input.operationId, "old-operation");
      return Response.json({ state: "completed", receipt });
    }
    return Response.json({ state: "released" });
  });
  await render(
    React.createElement(
      ui.AppSdkProvider,
      { host: ui.createAppHost({ name: "Notebook", active: true }) },
      React.createElement(ui.DeclaredAppCanvas, {
        source: { ...source, revision: 3, readOnly: true },
      }),
    ),
  );
  assert.match(document.body.textContent, /old-operation/);
  await click(
    [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Check action status",
    ),
  );
  assert.match(document.body.textContent, /not independent verification/);
  assert.match(document.body.textContent, /"revision": 1/);
  assert.equal(
    calls.some((call) => call.operation === "act"),
    false,
  );
  assert.equal(
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent === "Archive dataset",
    ),
    false,
  );
});

test('owner-declared bounded text edits preserve drafts on denial and route exact values only through Canvas', async t => {
  const env = await createUiRuntime(t, { contents: "export { DeclaredAppCanvas } from './app-canvas'; export { AppSdkProvider, createAppHost } from './host';", resolveDir: new URL('../src', import.meta.url).pathname });
  const { React, ui, render, click, dom } = env, calls = [];
  const edit = { name: 'canvas-update', label: 'Save dataset details', params: { name: 'Actual dataset', projectRef: '', expectedName: 'Actual dataset', expectedProjectRef: '', expectedArchived: false },
    inputs: [{ name: 'name', label: 'Dataset name', maxLength: 200 }, { name: 'projectRef', label: 'Project reference (Data label)', maxLength: 200 }] };
  t.mock.method(globalThis, 'fetch', async (_path, init) => {
    const input = JSON.parse(init.body); calls.push(input);
    return Response.json(input.operation === 'mount' ? { instance: 'edit-instance', source, projection: { ...projection, actions: [edit] } } : { state: input.operation === 'act' ? 'cancelled' : 'released' });
  });
  const mount = (readOnly = false) => render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', active: true }) }, React.createElement(ui.DeclaredAppCanvas, { source: { ...source, readOnly } })));
  await mount();
  const field = document.querySelector('input'); assert.equal(field.maxLength, 200);
  await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(field, '测量 renamed'); field.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  assert.equal(calls.filter(call => call.operation === 'act').length, 0);
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'Save dataset details'));
  assert.deepEqual(calls.find(call => call.operation === 'act').params, { ...edit.params, name: '测量 renamed' });
  assert.equal(document.querySelector('input').value, '测量 renamed'); assert.match(document.body.textContent, /cancelled before execution/);
  await mount(true); assert.equal(document.querySelector('input'), null);
});

test('known owner refusal is shown as not applied rather than a successful dataset mutation', async t => {
  const env = await createUiRuntime(t, { contents: "export { DeclaredAppCanvas } from './app-canvas'; export { AppSdkProvider, createAppHost } from './host';", resolveDir: new URL('../src', import.meta.url).pathname });
  const { React, ui, render, click } = env;
  t.mock.method(globalThis, 'fetch', async (_path, init) => {
    const input = JSON.parse(init.body);
    return Response.json(input.operation === 'mount' ? { instance: 'stale-instance', source, projection } : {
      state: 'completed', receipt: { result: { status: 'completed', outcome: 'not-applied', reason: 'Dataset metadata changed', dataset: { name: 'Newer owner value' } } },
    });
  });
  await render(React.createElement(ui.AppSdkProvider, { host: ui.createAppHost({ name: 'Notebook', active: true }) }, React.createElement(ui.DeclaredAppCanvas, { source })));
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'Archive dataset'));
  assert.match(document.body.textContent, /The App did not apply this change/);
  assert.doesNotMatch(document.body.textContent, /The App returned a completed result/);
  assert.match(document.body.textContent, /Newer owner value/);
});
