import test from "node:test";
import assert from "node:assert/strict";
import {
  AppApiError,
  checkEventPermission,
  createAppEventHub,
  createAppHost,
  createScopedApi,
  extractSteeringAcks,
  hasKeepVisibleMarker,
  parseOptions,
  scopedApiPath,
  stripKeepVisibleMarker,
} from "../src/core.mjs";

test("scoped API normalizes traversal and rejects foreign authorities", async () => {
  const calls = [];
  const api = createScopedApi({
    appName: "fixture",
    allowedApiPaths: ["/api/sessions"],
    hostHeaders: { "X-Point-Session-Id": "host-session" },
    fetch: async (path, init) => {
      calls.push({ path, init });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.deepEqual(
    await api.post("/api/sessions/one/actions?mode=review", { value: 1 }, {
      headers: { "X-Point-Session-Id": "forged" },
    }),
    { ok: true },
  );
  assert.equal(calls[0].path, "/api/sessions/one/actions?mode=review");
  assert.equal(calls[0].init.headers.get("x-point-session-id"), "host-session");
  assert.equal(calls[0].init.body, JSON.stringify({ value: 1 }));
  assert.throws(() => scopedApiPath("/api/sessions/x/../../settings", ["/api/sessions"], "fixture"), /cannot access/);
  await assert.rejects(api.get("https://example.com/api/sessions"), /Absolute URLs/);
  await assert.rejects(api.get("//example.com/api/sessions"), /Absolute URLs/);
  await assert.rejects(api.get("/\\example.com/api/sessions"), /Absolute URLs/);
});

test("scoped API preserves structured HTTP failures and empty success bodies", async () => {
  const failing = createScopedApi({
    appName: "fixture",
    allowedApiPaths: ["/api"],
    fetch: async () => new Response("denied", { status: 403 }),
  });
  await assert.rejects(failing.get("/api/value"), (error) => {
    assert.ok(error instanceof AppApiError);
    assert.equal(error.status, 403);
    assert.equal(error.body, "denied");
    return true;
  });
  const empty = createScopedApi({
    appName: "fixture",
    allowedApiPaths: ["/api"],
    fetch: async () => new Response(null, { status: 204 }),
  });
  assert.equal(await empty.del("/api/value"), undefined);
});

test("event subscriptions require an exact or namespaced declaration", () => {
  assert.equal(checkEventPermission("session:message", ["session:*"]).allowed, true);
  assert.equal(checkEventPermission("session", ["session:*"]).allowed, false);
  assert.equal(checkEventPermission("system:update", ["session:*"]).allowed, false);

  const events = createAppEventHub();
  const host = createAppHost({
    name: "fixture",
    allowedApiPaths: ["/api"],
    allowedEvents: ["session:*"],
    fetch: async () => new Response("{}"),
    subscribe: events.subscribe,
  });
  let received = null;
  const dispose = host.subscribe("session:message", (value) => { received = value; });
  events.emit("session:message", { seq: 7 });
  assert.deepEqual(received, { seq: 7 });
  dispose();
  events.emit("session:message", { seq: 8 });
  assert.deepEqual(received, { seq: 7 });
  assert.throws(() => host.subscribe("system:update", () => {}), /not declared/);
});

test("portable option, steering and keep-visible protocols are bounded", () => {
  assert.deepEqual(parseOptions("Choose one\n[OPTIONS: Alpha | Beta]"), {
    text: "Choose one",
    options: ["Alpha", "Beta"],
    multi: true,
    isPlan: false,
  });
  assert.deepEqual(parseOptions("Pick `[OPTION: Go | Cancel]`"), {
    text: "Pick",
    options: ["Go", "Cancel"],
    multi: false,
    isPlan: false,
  });
  assert.deepEqual(parseOptions("Literal [OPTIONS: A | B] followed by prose").options, []);
  assert.deepEqual(extractSteeringAcks("Done\n[STEERING steer-ab12: used the requested file]"), {
    cleaned: "Done",
    acks: ["used the requested file"],
  });
  const tagged = "Important result\n<!-- keep-visible -->";
  assert.equal(hasKeepVisibleMarker(tagged), true);
  assert.equal(stripKeepVisibleMarker(tagged), "Important result");
  const fenced = "```html\n<!-- keep-visible -->";
  assert.equal(hasKeepVisibleMarker(fenced), false);
  assert.equal(stripKeepVisibleMarker(fenced), fenced);
});

test("a host capability is lent only when declared and the host can serve it", async () => {
  const calls = [];
  const hostCall = async (capability, operation, input) => { calls.push([capability, operation, input]); return { ok: true }; };
  const host = createAppHost({ name: "calendar", allowedHostCapabilities: ["calendar", "calendar", 7], hostCall });
  assert.deepEqual([...host.info.permissions.host], ["calendar"]);
  assert.deepEqual(await host.capability("calendar").call("events", { startMs: 1, endMs: 2 }), { ok: true });
  assert.deepEqual(await host.capability("calendar").call("status"), { ok: true });
  assert.deepEqual(calls, [["calendar", "events", { startMs: 1, endMs: 2 }], ["calendar", "status", {}]]);
  assert.equal(host.capability("contacts"), null);
  assert.equal(createAppHost({ name: "calendar", allowedHostCapabilities: ["calendar"] }).capability("calendar"), null);
  assert.equal(createAppHost({ name: "other", hostCall }).capability("calendar"), null);
});
