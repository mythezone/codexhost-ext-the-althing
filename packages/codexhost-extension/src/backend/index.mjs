// The Host owns the IPC event loop. Keep disk transactions, parsing and compression
// on a single worker so a large portable archive cannot stall another invocation.
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { engine, methods } from "./rpc.ts";

if (!isMainThread && workerData?.althingEngine) {
  const backend = await engine(workerData.dataDir, workerData.settings);
  parentPort.on("message", async ({ id, method, params }) => {
    try {
      const value =
        method === "dispose"
          ? await backend.dispose()
          : await backend.call(method, params);
      parentPort.postMessage({ id, value: value ?? null });
    } catch (error) {
      parentPort.postMessage({
        id,
        error: String(error?.message || error).slice(0, 512),
      });
    }
  });
  parentPort.postMessage({ ready: true });
}

export async function activate(ctx) {
  const settings = await ctx.readSettings();
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { althingEngine: true, dataDir: ctx.dataDir, settings },
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 128 },
  });
  const pending = new Map(),
    receipts = new Map();
  let failure, ready, startupFailed;
  const startup = new Promise((resolve, reject) => {
    ready = resolve;
    startupFailed = reject;
  });
  function fail(error) {
    failure ??= error;
    startupFailed(error);
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  }
  worker.on("error", fail);
  worker.on("exit", (code) =>
    fail(new Error("Council worker exited (" + code + ")")),
  );
  worker.on("message", (reply) => {
    if (reply.ready) {
      ready();
      return;
    }
    const job = pending.get(reply.id);
    if (!job) return;
    pending.delete(reply.id);
    if (reply.error) job.reject(new Error(reply.error));
    else job.resolve(reply.value);
  });
  function request(method, params) {
    if (failure) return Promise.reject(failure);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, params });
    });
  }
  function receipt(id) {
    const job = receipts.get(id);
    if (!job) throw Error("Unknown or expired operation");
    if (job.status === "pending") return { operationId: id, status: "pending" };
    if (job.status === "failed") throw Error(job.error);
    return job.value;
  }
  for (const name of methods)
    ctx.handle(name, async (params) => {
      for (const [key, item] of receipts)
        if (item.expires < Date.now()) receipts.delete(key);
      if (name === "althing/operations/get")
        return receipt(params?.operationId);
      const promise = request(name.slice("althing/".length), params ?? {});
      const id = randomUUID();
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((resolve) => {
            timer = setTimeout(() => {
              const job = { status: "pending" };
              receipts.set(id, job);
              promise
                .then(
                  (value) => Object.assign(job, { status: "completed", value }),
                  (error) =>
                    Object.assign(job, {
                      status: "failed",
                      error: error.message,
                    }),
                )
                .finally(() => {
                  job.expires = Date.now() + 5 * 60_000;
                });
              resolve({ operationId: id, status: "pending" });
            }, 1400);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    });
  let startupTimer;
  try {
    await Promise.race([
      startup,
      new Promise((_, reject) => {
        startupTimer = setTimeout(
          () => reject(new Error("Council storage startup timed out")),
          3500,
        );
      }),
    ]);
  } catch (error) {
    await worker.terminate();
    throw error;
  } finally {
    clearTimeout(startupTimer);
  }
  return {
    async dispose() {
      let timer;
      try {
        if (!failure)
          await Promise.race([
            request("dispose", {}),
            new Promise((resolve) => {
              timer = setTimeout(resolve, 650).unref();
            }),
          ]);
      } finally {
        clearTimeout(timer);
        await worker.terminate();
        receipts.clear();
      }
    },
  };
}
