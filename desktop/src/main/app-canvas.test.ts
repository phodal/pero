import test from "node:test";
import assert from "node:assert/strict";
import { AppCanvasRequests } from "./app-canvas.ts";
import Ajv2020 from "ajv/dist/2020.js";
import hostSchema from "../../../protocol/generated/host.schema.json" with { type: "json" };

const action = {
  operation: "act",
  instance: "instance-a",
  operationId: "operation-a",
  action: "canvas-archive",
  params: { archived: true },
};
test("Canvas actions never bypass trusted confirmation and retries share the exact pending operation", async () => {
  const calls: any[] = [];
  let resolve!: (value: boolean) => void, prompted!: () => void;
  const shown = new Promise<void>((done) => {
    prompted = done;
  });
  const owner = new AppCanvasRequests(
    async (input) => {
      calls.push(input);
      return (input as any).operation === "prepare"
        ? {
            state: "requires-approval",
            ticket: "private",
            summary: "Frozen saved revision and action",
          }
        : {
            state: (input as any).allow ? "completed" : "cancelled",
            receipt: { operationId: "operation-a" },
          };
    },
    async () => {
      prompted();
      return new Promise<boolean>((done) => {
        resolve = done;
      });
    },
  );
  const first = owner.apply(action);
  await shown;
  const second = owner.apply(action);
  assert.equal(calls.length, 1);
  await assert.rejects(
    owner.apply({ ...action, params: { archived: false } }),
    /different inputs/,
  );
  resolve(true);
  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(left, right);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], {
    operation: "decide",
    instance: "instance-a",
    operationId: "operation-a",
    ticket: "private",
    allow: true,
  });
  for (const bad of [
    { ...action, allow: true },
    { ...action, ticket: "forged" },
    {
      operation: "decide",
      instance: "instance-a",
      operationId: "operation-a",
      ticket: "forged",
      allow: true,
    },
  ])
    await assert.rejects(owner.apply(bad), /does not accept/);
});
test("close, explicit cancellation and denial cannot decide allow", async () => {
  for (const cancel of ["cancel", "release", "close", "deny"]) {
    const calls: any[] = [];
    let resolve!: (value: boolean) => void, prompted!: () => void;
    const shown = new Promise<void>((done) => {
      prompted = done;
    });
    const owner = new AppCanvasRequests(
      async (input) => {
        calls.push(input);
        return (input as any).operation === "prepare"
          ? {
              state: "requires-approval",
              ticket: "private",
              summary: "Archive",
            }
          : { state: "cancelled" };
      },
      async (_summary, signal) => {
        prompted();
        return new Promise<boolean>((done) => {
          resolve = done;
          signal.addEventListener("abort", () => done(false), { once: true });
        });
      },
    );
    const pending = owner.apply(action);
    await shown;
    if (cancel === "close") owner.close();
    else if (cancel === "deny") resolve(false);
    else
      await owner.apply(
        cancel === "release"
          ? { operation: "release", instance: action.instance }
          : {
              operation: "cancel",
              instance: action.instance,
              operationId: action.operationId,
            },
      );
    await pending;
    assert.equal(
      calls.some((call) => call.operation === "decide" && call.allow),
      false,
      cancel,
    );
  }
  await assert.rejects(
    new AppCanvasRequests(async () => {}).apply(action),
    /confirmation is unavailable/,
  );
});


test("originating frame cancellation denies late approval and releases late mounts", async () => {
  const calls: any[] = [];
  const controller = new AbortController();
  let resolve!: (value: boolean) => void, shown!: () => void;
  const prompted = new Promise<void>(done => { shown = done; });
  const owner = new AppCanvasRequests(async input => {
    calls.push(input);
    return (input as any).operation === "prepare" ? { state: "requires-approval", ticket: "private", summary: "Exact saved action" } : { state: "cancelled" };
  }, async () => { shown(); return new Promise<boolean>(done => { resolve = done; }); });
  const pending = owner.apply(action, controller.signal); await prompted; controller.abort(); resolve(true); await pending;
  assert.equal(calls.some(call => call.operation === "decide" && call.allow), false);
  const closed = new AbortController(); closed.abort();
  const late = new AppCanvasRequests(async input => { calls.push(input); return { instance: "late-instance" }; });
  await assert.rejects(late.apply({ operation: "mount", source: {} }, closed.signal), /was closed/);
  assert.deepEqual(calls.at(-1), { operation: "release", instance: "late-instance" });
});


test("Host Canvas protocol uses bounded numeric Notebook revisions", () => {
  const ajv = new Ajv2020({ strict: true, strictTypes: false });
  ajv.addSchema(hostSchema);
  const validate = ajv.getSchema(`${hostSchema.$id}#/$defs/AppRequest`)!;
  const source = { entryId: "a".repeat(32), revision: 1, blockId: "canvas", readOnly: false,
    binding: { id: "binding", app: "data", panel: "main", view: "dataset-inspector", declaration: "b".repeat(64), inputs: { datasetId: "ds-" + "c".repeat(32) } } };
  for (const [revision, accepted] of [[1, true], [2147483647, true], ["1", false], [0, false], [-1, false], [1.5, false], [2147483648, false]]) {
    const request = { method: "apps", id: "mount", action: "canvas", name: "notebook", request: { operation: "mount", source: { ...source, revision } } };
    assert.equal(validate(request), accepted, `Revision ${JSON.stringify(revision)}: ${ajv.errorsText(validate.errors)}`);
  }
});
