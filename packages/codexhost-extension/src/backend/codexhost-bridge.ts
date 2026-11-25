import { agentDirectory } from "./agent-directory.ts";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const modelRef = z
  .object({
    id: z.string().min(1),
    serviceTier: z.enum(["priority", "ultrafast"]).optional(),
  })
  .strict();
export type Model = string | z.infer<typeof modelRef>;
export type Start = {
  harness: string;
  cwd: string;
  task: string;
  model?: Model;
  thinking?: string;
  watch?: true;
  taskName?: string;
  refs?: string[];
  requestId?: string;
};
export type ThreadSnapshot = {
  threadId: string;
  status: string;
  turn?: { turnId: string; status: string } | null;
  progress?: { text: string; turnId?: string }[];
  result?: { availability?: string; text?: string; message?: string };
  turns?: {
    turnId: string | null;
    turnNumber: number;
    status: string;
    messages: { role: string; phase?: string; text: string }[];
  }[];
};
type Inspection = {
  harnessId: string;
  inspection: {
    status: string;
    catalog?: {
      models: {
        ref: z.infer<typeof modelRef>;
        fastModel?: z.infer<typeof modelRef>;
      }[];
    };
  };
};
type Credentials = { endpoint: string; token: string };
function endpoint(input: string) {
  const u = new URL(input);
  if (
    u.protocol !== "http:" ||
    u.hostname !== "127.0.0.1" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw Error("Expected a local CodexHost HTTP endpoint");
  return u.origin;
}
async function credentials(file: string): Promise<Credentials> {
  const h = await open(
    file,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const info = await h.stat();
    if (
      !info.isFile() ||
      info.size > 4096 ||
      (process.platform !== "win32" &&
        (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))
    )
      throw Error("Invalid or non-private Host credentials");
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await h.read(bytes);
    if (bytesRead !== info.size) throw Error("Host credentials changed");
    const v = JSON.parse(bytes.toString("utf8", 0, bytesRead));
    if (
      v?.schemaVersion !== 1 ||
      typeof v.token !== "string" ||
      !/^chc_[A-Za-z0-9_-]{43}$/u.test(v.token) ||
      typeof v.startedAt !== "string" ||
      !Number.isSafeInteger(v.pid) ||
      v.pid <= 0
    )
      throw Error("Invalid Host credentials");
    process.kill(v.pid, 0);
    return { endpoint: endpoint(v.endpoint), token: v.token };
  } finally {
    await h.close();
  }
}
export class HostError extends Error {
  constructor(
    message: string,
    readonly transient = false,
  ) {
    super(message);
  }
}
export class CodexHostBridge {
  private cached?: Credentials;
  private readonly directories = new Map<
    string,
    { expires: number; result: ReturnType<typeof agentDirectory> }
  >();
  listAgents(cwd?: string, refresh = false) {
    const key = cwd || "";
    const previous = this.directories.get(key);
    if (
      previous &&
      (!refresh || previous.expires === Infinity) &&
      previous.expires > Date.now()
    )
      return previous.result;
    const result = agentDirectory(this, path.dirname(this.file), cwd, refresh);
    const entry = { expires: Infinity, result };
    this.directories.set(key, entry);
    if (this.directories.size > 8)
      this.directories.delete(this.directories.keys().next().value!);
    result.then(
      () => {
        entry.expires = Date.now() + 30_000;
      },
      () => {
        if (this.directories.get(key) === entry) this.directories.delete(key);
      },
    );
    return result;
  }
  private stop = new AbortController();
  private readonly file: string;
  constructor(
    ctx: { dataDir: string },
    private settings: Record<string, unknown> = {},
  ) {
    this.file = path.join(
      process.env.CODEXHOST_DATA_DIR || path.resolve(ctx.dataDir, "..", ".."),
      "cli-credentials.json",
    );
  }
  dispose() {
    this.stop.abort();
  }
  private async discover() {
    if (this.cached) return this.cached;
    const url = this.settings.externalEndpoint,
      token = this.settings.clientToken;
    const local = url && token ? null : await credentials(this.file);
    return (this.cached = {
      endpoint: endpoint(String(url || local!.endpoint)),
      token: String(token || local!.token),
    });
  }
  private async post<T>(
    route: string,
    params: object,
    deadline = AbortSignal.timeout(12_000),
  ): Promise<T> {
    const signal = AbortSignal.any([deadline, this.stop.signal]);
    for (let attempt = 0; ; attempt++) {
      let auth: Credentials;
      try {
        auth = await this.discover();
      } catch {
        throw new HostError(
          "Local CodexHost credentials unavailable or invalid",
          true,
        );
      }
      try {
        const res = await fetch(auth.endpoint + "/v1/" + route, {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            authorization: "Bearer " + auth.token,
            "content-type": "application/json",
          },
          body: JSON.stringify(params),
        });
        if (res.status === 401 && !attempt) {
          this.cached = undefined;
          await res.body?.cancel();
          continue;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new HostError(
            "CodexHost HTTP " +
              res.status +
              (body?.error?.message
                ? " — " + body.error.message.slice(0, 300)
                : ""),
            res.status >= 500 || res.status === 401,
          );
        }
        return (await res.json()) as T;
      } catch (e) {
        if (e instanceof HostError) throw e;
        this.cached = undefined;
        const refused =
          (e as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED";
        // A disconnected send may already have reached the Thread. Only replay unambiguous or idempotent requests.
        if (
          !attempt &&
          !signal.aborted &&
          (refused ||
            !["thread/send", "delegate/start"].includes(route) ||
            "requestId" in params)
        )
          continue;
        throw new HostError(
          signal.aborted
            ? "CodexHost request timed out or stopped"
            : "CodexHost connection failed",
          true,
        );
      }
    }
  }
  async getStatus() {
    try {
      return { connected: true, info: await this.getHostInfo(), error: null };
    } catch (e) {
      return { connected: false, info: null, error: (e as Error).message };
    }
  }
  getHostInfo(refresh = false) {
    return this.post<Record<string, unknown>>("host/info", { refresh });
  }
  listProjects(
    params: {
      query?: string;
      offset?: number;
      limit?: number;
      refresh?: boolean;
    } = {},
  ) {
    return this.post<{ projects: unknown[]; nextOffset: number | null }>(
      "project/list",
      params,
    );
  }
  async workspaces(
    params: {
      query?: string;
      offset?: number;
      limit?: number;
      refresh?: boolean;
    } = {},
  ) {
    const inventory = async () => {
      const result: Record<string, unknown>[] = [];
      let offset = 0;
      do {
        const page = await this.listProjects({
          offset,
          limit: 100,
          refresh: offset === 0 && params.refresh,
        });
        result.push(...(page.projects as Record<string, unknown>[]));
        if (page.nextOffset == null || page.nextOffset <= offset) break;
        offset = page.nextOffset;
      } while (true);
      return result;
    };
    const [projects, host, recent] = await Promise.allSettled([
      inventory(),
      this.getHostInfo(),
      this.listThreads({ limit: 100 }),
    ]);
    if (
      [projects, host, recent].every((r) => r.status === "rejected") &&
      projects.status === "rejected"
    )
      throw projects.reason;
    const merged = new Map<string, Record<string, unknown>>();
    function add(cwd: unknown, project: Record<string, unknown> = {}) {
      if (typeof cwd !== "string" || !cwd.trim()) return;
      const isWindows = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(cwd),
        paths = isWindows ? path.win32 : path.posix;
      const normalized = paths.normalize(cwd.trim()),
        key = normalized.replace(/[\\/]+$/, "") || normalized;
      const canonical = isWindows ? key.toLowerCase() : key;
      if (!merged.has(canonical))
        merged.set(canonical, {
          ...project,
          cwd: cwd.trim(),
          name: project.name || paths.basename(key) || key,
        });
    }
    if (projects.status === "fulfilled")
      for (const p of projects.value) add(p.cwd, p);
    if (host.status === "fulfilled") add(host.value.defaultWorkspace);
    if (recent.status === "fulfilled")
      for (const t of recent.value.threads as { cwd?: string }[]) add(t.cwd);
    const query = params.query?.toLowerCase() ?? "",
      offset = params.offset ?? 0,
      limit = params.limit ?? 100;
    const all = [...merged.values()].filter((p) =>
      [p.cwd, p.name, p.description].join(" ").toLowerCase().includes(query),
    );
    return {
      projects: all.slice(offset, offset + limit),
      total: all.length,
      nextOffset: offset + limit < all.length ? offset + limit : null,
    };
  }
  listHarnesses() {
    return this.post<{ harnesses: unknown[] }>("harness/list", {});
  }
  inspectHarness(harnessId: string, cwd?: string, refresh = false) {
    return this.post<Inspection>(
      "harness/inspect",
      {
        harnessId,
        cwd,
        refresh,
      },
      AbortSignal.timeout(10_000),
    );
  }
  async delegateStart({ harness, cwd, model, thinking, ...rest }: Start) {
    const deadline = AbortSignal.timeout(30_000);
    let ref = typeof model === "string" ? { id: model } : model;
    if (typeof model === "string") {
      const suffix = /~(fast|ultrafast)$/.exec(model);
      if (suffix) {
        const candidate = {
          id: model.slice(0, suffix.index),
          serviceTier:
            suffix[1] === "fast"
              ? ("priority" as const)
              : ("ultrafast" as const),
        };
        const catalog = await this.post<Inspection>(
          "harness/inspect",
          { harnessId: harness, cwd },
          deadline,
        );
        const advertised =
          catalog.inspection?.catalog?.models
            .flatMap((m) => [m.ref, m.fastModel])
            .filter((r) => r != null) ?? [];
        ref =
          advertised.find((r) => r.id === model && !r.serviceTier) ??
          advertised.find((r) => r.id === model) ??
          advertised.find(
            (r) =>
              r.id === candidate.id && r.serviceTier === candidate.serviceTier,
          ) ??
          ref;
      }
    }
    return this.post<{ threadId: string; turnId?: string; status: string }>(
      "delegate/start",
      {
        ...rest,
        harness,
        cwd,
        model: ref ? modelRef.parse(ref) : undefined,
        thinkingOptionId: thinking || undefined,
        watch: true,
      },
      deadline,
    );
  }
  readThread(
    threadId: string,
    view: "result" | "messages" = "result",
    from?: number,
    to?: number,
  ) {
    return this.post<ThreadSnapshot>("thread/read", {
      threadId,
      view,
      from,
      to,
    });
  }
  sendThread(
    threadId: string,
    message: string,
    opts: {
      interrupt?: boolean;
      steer?: boolean;
      watch?: boolean;
      watchTimeoutMs?: number;
    } = {},
  ) {
    return this.post<{ threadId: string; turnId?: string }>(
      "thread/send",
      {
        threadId,
        message,
        watch: true,
        ...opts,
      },
      AbortSignal.timeout(30_000),
    );
  }
  cancelThread(threadId: string) {
    return this.post<Record<string, unknown>>("thread/cancel", { threadId });
  }
  listThreads(
    params: {
      limit?: number;
      sort?: string;
      cwd?: string;
      ref?: string;
      client?: string;
    } = {},
  ) {
    return this.post<{ threads: unknown[] }>("thread/list", params);
  }
}
