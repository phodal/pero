// Real Host + installed Notebook/Data backends. No Agent session or target App origin is used.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../protocol/generated/host.schema.json" with { type: "json" };
const root = resolve(import.meta.dirname, "../.."),
  directory = await mkdtemp(resolve(tmpdir(), "pero-canvas-contract-"));
const ajv = new Ajv2020({ strict: true, strictTypes: false });
ajv.addSchema(schema);
const inputSchema = ajv.getSchema(`${schema.$id}#/$defs/AppRequest`),
  outputSchema = ajv.getSchema(`${schema.$id}#/$defs/AppsResultEvent`);
async function launch() {
  const child = spawn(resolve(root, "target/debug/pero-host"), ["--stdio"], {
    cwd: directory,
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      UV_OFFLINE: "1",
      PERO_SETTINGS_PATH: resolve(directory, "settings.json"),
      PERO_APPS_ROOT: resolve(directory, "apps"),
      PERO_BUILTIN_APPS_ROOT: "",
    },
  });
  const exit = new Promise((done) => child.once("exit", done)),
    pending = new Map();
  let ready;
  const started = new Promise((done) => {
    ready = done;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const event = JSON.parse(line);
    if (event.kind === "ready") ready();
    if (event.kind === "apps_result") {
      assert(outputSchema(event), ajv.errorsText(outputSchema.errors));
      pending.get(event.request_id)?.(event.data);
    }
  });
  await Promise.race([
    started,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Host readiness timeout")),
        15000,
      );
      timer.unref();
    }),
  ]);
  return {
    async request(action, fields = {}) {
      const request = {
        method: "apps",
        id: crypto.randomUUID(),
        action,
        ...fields,
      };
      assert(inputSchema(request), ajv.errorsText(inputSchema.errors));
      return new Promise((done, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Canvas Host ${action} timed out`)),
          20000,
        );
        pending.set(request.id, (value) => {
          clearTimeout(timer);
          pending.delete(request.id);
          done(value);
        });
        child.stdin.write(JSON.stringify(request) + "\n");
      });
    },
    async close() {
      child.stdin.end();
      await exit;
    },
  };
}
let host;
try {
  execFileSync(
    process.env.PERO_APP_PYTHON || "python3",
    ["-I", "-m", "venv", "--without-pip", resolve(directory, "python")],
    { timeout: 30000 },
  );
  await writeFile(
    resolve(directory, "settings.json"),
    JSON.stringify({ app_python: { default: resolve(directory, "python") } }),
  );
  host = await launch();
  for (const name of ["notebook", "data"]) {
    const target = resolve(directory, "sources", name);
    await mkdir(resolve(target, "dist"), { recursive: true });
    await cp(
      resolve(root, "apps", name, "backend"),
      resolve(target, "backend"),
      { recursive: true },
    );
    if (name === "data") {
      await mkdir(resolve(target, "backend/_core"), { recursive: true });
      for (const module of ["dataset.py", "view.py", "chart_document.py"])
        await cp(resolve(root, "harness/go/charts/python", module), resolve(target, "backend/_core", module));
    }
    await cp(
      resolve(root, "apps", name, "app.json"),
      resolve(target, "app.json"),
    );
    await writeFile(
      resolve(target, "dist/index.html"),
      "<h1>Backend contract fixture</h1>",
    );
    const installed = await host.request("install", { path: target });
    assert.equal(installed.ok, true, installed.error);
    assert.equal((await host.request("enable", { name })).ok, true);
  }
  const backend = async (name, path, body) => {
    const access = await host.request("resolve", { name });
    assert.equal(access.ok, true, access.error);
    const response = await fetch(access.value.backend.url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-Pero-App-Token": access.value.backend.token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const value = await response.json();
    assert.equal(response.ok, true, JSON.stringify(value));
    return value;
  };
  await backend("data", "/api/import", {
    name: "actual.csv",
    kind: "dataset",
    content: Buffer.from("x,y\n1,2\n").toString("base64"),
  });
  const state = await backend("data", "/api/state");
  const dataset = state.datasets[0];
  assert(dataset, "Import must create an actual Data dataset");
  const context = await host.request("sdkcontext", { name: "notebook" });
  const declaration = context.value.appViews.find(
    (item) => item.app === "data",
  );
  assert.equal(declaration.canvases[0].id, "dataset-inspector");
  const binding = {
    id: "binding",
    app: "data",
    panel: "main",
    view: "dataset-inspector",
    declaration: declaration.revision,
    inputs: { datasetId: dataset.id },
  };
  const document = {
    schemaVersion: 1,
    title: "Actual Canvas",
    content: {
      type: "doc",
      content: [
        {
          type: "appCanvas",
          attrs: { blockId: "canvas", label: "Data", binding },
        },
      ],
    },
  };
  const created = await backend("notebook", "/api/entries", { document });
  const source = {
    entryId: created.id,
    revision: created.revision,
    blockId: "canvas",
    binding,
    readOnly: false,
  };
  const canvas = async (request) =>
    host.request("canvas", { name: "notebook", request });
  const mount = await canvas({ operation: "mount", source });
  assert.equal(mount.ok, true, mount.error);
  assert.equal(
    mount.value.projection.fields.find((field) => field.label === "Dataset")
      .value,
    dataset.id,
  );
  const instance = mount.value.instance;
  const readonly = await canvas({
    operation: "mount",
    source: { ...source, readOnly: true },
  });
  assert.equal(readonly.ok, true, readonly.error);
  const action = {
    operation: "prepare",
    instance,
    operationId: "op-archive",
    action: "canvas-archive",
    params: { archived: true },
  };
  assert.equal(
    (await canvas({ ...action, instance: readonly.value.instance })).ok,
    false,
  );
  const denied = await canvas({ ...action, operationId: "op-denied" });
  assert.equal(denied.value.state, "requires-approval");
  assert.equal(
    (await canvas({ operation: "cancel", instance, operationId: "op-denied" }))
      .value.state,
    "cancelled",
  );
  assert.equal(
    (
      await canvas({
        operation: "decide",
        instance,
        operationId: "op-denied",
        ticket: denied.value.ticket,
        allow: true,
      })
    ).ok,
    false,
  );
  assert.equal(
    (await backend("data", "/api/state")).datasets[0].archived,
    false,
  );
  const prepared = await canvas(action);
  assert.equal(prepared.value.state, "requires-approval");
  const completed = await canvas({
    operation: "decide",
    instance,
    operationId: "op-archive",
    ticket: prepared.value.ticket,
    allow: true,
  });
  assert.equal(completed.ok, true, completed.error);
  assert.equal(completed.value.receipt.result.dataset.archived, true);
  assert.equal(
    (
      await canvas({
        operation: "decide",
        instance,
        operationId: "op-archive",
        ticket: prepared.value.ticket,
        allow: true,
      })
    ).ok,
    false,
  );
  await canvas({ operation: "release", instance });
  assert.equal((await canvas({ operation: "read", instance })).ok, false);
  // Discard the first response, restart Host and recover the actual owner receipt, read-only.
  await host.close();
  host = await launch();
  const recovered = await canvas({
    operation: "mount",
    source: { ...source, readOnly: true },
  });
  assert.equal(recovered.ok, true, recovered.error);
  assert.equal(recovered.value.history[0].operationId, "op-archive");
  const cancelledRecovery = await canvas({ operation: "cancel", instance: recovered.value.instance, operationId: "op-archive" });
  assert.equal(cancelledRecovery.value.state, "outcome-unknown");
  const observed = await canvas({
    operation: "status",
    instance: recovered.value.instance,
    operationId: "op-archive",
  });
  assert.deepEqual(observed.value.receipt, completed.value.receipt);
  const editable = await canvas({ operation: "mount", source });
  assert.equal(
    (
      await canvas({
        ...action,
        instance: editable.value.instance,
        params: { archived: false },
      })
    ).ok,
    false,
  );
  assert.equal((await host.request("disable", { name: "data" })).ok, true);
  assert.equal(
    (await canvas({ operation: "read", instance: recovered.value.instance }))
      .ok,
    false,
  );
  assert.equal(
    (
      await host.request("canvas", {
        name: "data",
        request: { operation: "mount", source },
      })
    ).ok,
    false,
  );
  const journal = await readFile(
    resolve(directory, "apps/.canvas-operations.json"),
    "utf8",
  );
  assert(!journal.includes("ticket"));
  console.log(
    "Canvas Host/Notebook/Data contract passed: actual projection, consent, readonly restriction, replay, release, restart recovery, scope, disabled owner.",
  );
} finally {
  if (host) await host.close();
  await rm(directory, { recursive: true, force: true });
}
