import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { temp } from "./helpers.ts";

type Thread = {
  threadId: string;
  turnId: string;
  status: string;
  output: string;
  final: string;
  progress: string;
};
export async function mockHost(t: TestContext) {
  const previousDataDir = process.env.CODEXHOST_DATA_DIR;
  delete process.env.CODEXHOST_DATA_DIR;
  t.after(() => {
    if (previousDataDir !== undefined)
      process.env.CODEXHOST_DATA_DIR = previousDataDir;
  });
  const root = await temp(t),
    dataDir = path.join(root, "host-extension-data", "the-althing");
  await mkdir(dataDir, { recursive: true });
  const options = {
    infoDelay: 0,
    inspections: null as Record<string, unknown> | null,
    emptyProjects: false,
    threadCwds: [] as string[],
    defaultWorkspace: "",
  };
  const token = () => "chc_" + randomBytes(32).toString("base64url");
  let bearer = token(),
    unauthorized = 0,
    next = 0,
    reads = 0;
  const threads = new Map<string, Thread>(),
    calls: { route: string; body: Record<string, unknown> }[] = [];
  const http = createServer(async (req, res) => {
    function send(value: unknown, code = 200) {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    }
    if (req.headers.authorization !== "Bearer " + bearer) {
      unauthorized++;
      send({ error: { code: "UNAUTHORIZED" } }, 401);
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      route = req.url!;
    calls.push({ route, body });
    const thread = threads.get(body.threadId);
    switch (route) {
      case "/v1/host/info":
        if (options.infoDelay)
          await new Promise((resolve) =>
            setTimeout(resolve, options.infoDelay),
          );
        return send({
          id: "host",
          name: "Mock Host",
          defaultWorkspace: options.defaultWorkspace,
        });
      case "/v1/project/list":
        return send({
          projects: options.emptyProjects
            ? []
            : [{ cwd: "/projects/study", name: "Study" }],
          nextOffset: null,
        });
      case "/v1/harness/list":
        return send({
          harnesses: options.inspections
            ? Object.keys(options.inspections)
            : [{ id: "codex" }, { id: "other" }],
        });
      case "/v1/harness/inspect":
        if (options.inspections)
          return send({
            harnessId: body.harnessId,
            inspection: options.inspections[body.harnessId],
          });
        return send({
          harnessId: body.harnessId,
          inspection: {
            status: "ready",
            catalog: {
              models: [
                {
                  ref: { id: "model" },
                  fastModel: { id: "model", serviceTier: "priority" },
                },
                { ref: { id: "model", serviceTier: "ultrafast" } },
                { ref: { id: "literal" }, fastModel: { id: "literal~fast" } },
              ],
            },
          },
        });
      case "/v1/delegate/start": {
        const tid = "thr-" + ++next,
          turnId = tid + "-1";
        threads.set(tid, {
          threadId: tid,
          status: "running",
          turnId,
          output: "",
          final: "",
          progress: "Reviewing evidence",
        });
        return send({
          threadId: tid,
          turnId,
          harnessId: body.harness,
          status: "running",
          watch: { state: "watching" },
        });
      }
      case "/v1/thread/list":
        return send({
          threads: [
            ...options.threadCwds.map((cwd, i) => ({
              threadId: "inventory-" + i,
              cwd,
            })),
            ...[...threads.values()].map(({ threadId, status }) => ({
              threadId,
              status,
            })),
          ],
        });
      case "/v1/thread/read": {
        reads++;
        if (!thread) return send({ error: { message: "Unknown thread" } }, 404);
        const base = {
          threadId: thread.threadId,
          harnessId: "codex",
          turn: { turnId: thread.turnId, status: thread.status },
          status: thread.status,
          progress: [{ id: "p", turnId: thread.turnId, text: thread.progress }],
          result: {
            availability: thread.output ? "available" : "unavailable",
            text: thread.output,
            message: thread.status === "failed" ? "Harness exited" : "",
          },
        };
        if (body.view !== "messages") return send(base);
        return send({
          ...base,
          totalTurns: 1,
          from: 1,
          to: 1,
          turns: [
            {
              turnNumber: 1,
              turnId: thread.turnId,
              status: thread.status,
              messages: [
                { id: "user", role: "user", text: "Question" },
                ...(thread.final
                  ? [
                      {
                        id: "final",
                        role: "agent",
                        phase: "final",
                        text: thread.final,
                      },
                    ]
                  : []),
              ],
            },
          ],
        });
      }
      case "/v1/thread/send": {
        if (!thread) return send({}, 404);
        Object.assign(thread, {
          turnId: thread.turnId + "-next",
          status: "running",
          output: "",
          final: "",
        });
        return send({
          threadId: thread.threadId,
          turnId: thread.turnId,
          status: "running",
        });
      }
      case "/v1/thread/cancel":
        if (thread) thread.status = "interrupted";
        return send({ threadId: body.threadId });
      default:
        return send({ error: { message: "Unknown route" } }, 404);
    }
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const endpoint = "http://127.0.0.1:" + (http.address() as AddressInfo).port,
    credPath = path.join(root, "cli-credentials.json");
  const writeCred = () =>
    writeFile(
      credPath,
      JSON.stringify({
        schemaVersion: 1,
        endpoint,
        token: bearer,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
  await writeCred();
  const stop = async () => {
    if (!http.listening) return;
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  };
  t.after(stop);
  return {
    root,
    stop,
    dataDir,
    options,
    endpoint,
    credPath,
    calls,
    threads,
    get token() {
      return bearer;
    },
    get unauthorized() {
      return unauthorized;
    },
    get reads() {
      return reads;
    },
    async rotate() {
      bearer = token();
      await writeCred();
    },
    routes(route: string) {
      return calls.filter((c) => c.route === "/v1/" + route);
    },
    finish(tid: string, text: string, fallback = false) {
      Object.assign(threads.get(tid)!, {
        status: "completed",
        output: fallback ? "" : text,
        final: text,
      });
    },
  };
}
