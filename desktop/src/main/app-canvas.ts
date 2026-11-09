/** Interactive App requests enter the existing trusted shell confirmation, never App consent. */
export class AppCanvasRequests {
  private pending = new Map<
    string,
    {
      instance: string;
      input: string;
      controller: AbortController;
      result: Promise<unknown>;
    }
  >();
  private request: (input: object) => Promise<any>;
  private confirm?: (summary: string, signal: AbortSignal) => Promise<boolean>;
  constructor(
    request: (input: object) => Promise<any>,
    confirm?: (summary: string, signal: AbortSignal) => Promise<boolean>,
  ) {
    this.request = request;
    this.confirm = confirm;
  }
  close() {
    for (const operation of this.pending.values()) operation.controller.abort();
  }
  async apply(value: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid Canvas request");
    const input = value as Record<string, unknown>,
      operation = input.operation;
    const fields = {
      mount: ["operation", "source"],
      read: ["operation", "instance"],
      release: ["operation", "instance"],
      act: ["operation", "instance", "operationId", "action", "params"],
      status: ["operation", "instance", "operationId"],
      cancel: ["operation", "instance", "operationId"],
    };
    if (
      typeof operation !== "string" ||
      !Object.hasOwn(fields, operation) ||
      Object.keys(input).sort().join() !==
        fields[operation as keyof typeof fields].sort().join()
    )
      throw new Error(
        "Canvas does not accept approval, routes or private tickets",
      );
    if (
      operation !== "mount" &&
      (typeof input.instance !== "string" || input.instance.length > 128)
    )
      throw new Error("Invalid Canvas instance");
    if (
      ["act", "status", "cancel"].includes(operation) &&
      (typeof input.operationId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(input.operationId))
    )
      throw new Error("Invalid operation identity");
    const key = `${input.instance}:${input.operationId}`;
    if (operation === "release")
      for (const active of this.pending.values()) {
        if (active.instance === input.instance) active.controller.abort();
      }
    if (operation === "cancel") this.pending.get(key)?.controller.abort();
    if (operation !== "act") {
      const value = await this.request(input);
      if (operation === "mount" && signal?.aborted && typeof value.instance === "string") {
        await this.request({ operation: "release", instance: value.instance });
        throw new Error("The originating Canvas request was closed");
      }
      return value;
    }
    const serialized = JSON.stringify(input),
      active = this.pending.get(key);
    if (active) {
      if (active.input !== serialized)
        throw new Error("Operation identity belongs to different inputs");
      return active.result;
    }
    if (!this.confirm)
      throw new Error("Trusted App action confirmation is unavailable");
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const entry = {
      instance: input.instance as string,
      input: serialized,
      controller,
      result: Promise.resolve<unknown>(undefined),
    };
    this.pending.set(key, entry);
    entry.result = Promise.resolve()
      .then(async () => {
        const prepared = await this.request({ ...input, operation: "prepare" });
        if (prepared.state !== "requires-approval") return prepared;
        if (
          typeof prepared.ticket !== "string" ||
          prepared.ticket.length > 128 ||
          typeof prepared.summary !== "string" ||
          prepared.summary.length > 16000
        )
          throw new Error("Invalid Host action confirmation");
        let allowed = false;
        try {
          if (!controller.signal.aborted)
            allowed = await this.confirm!(prepared.summary, controller.signal);
        } catch {
          allowed = false;
        }
        if (controller.signal.aborted)
          return this.request({
            operation: "cancel",
            instance: input.instance,
            operationId: input.operationId,
          });
        return this.request({
          operation: "decide",
          instance: input.instance,
          operationId: input.operationId,
          ticket: prepared.ticket,
          allow: allowed,
        });
      })
      .finally(() => { signal?.removeEventListener("abort", abort); this.pending.delete(key); });
    return entry.result;
  }
}
