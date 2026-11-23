import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useCallback,
  useRef,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import {
  useL,
  LocaleContext,
  AssetContext,
  WorkspaceContext,
  type Run,
} from "./context";
import {
  listenAppearance,
  workspaceKey,
  type HostApi,
  type Destination,
  type Surface,
  type Project,
} from "./host";
import { RpcClient, watchEvents } from "./rpc-client";
import type { Card, Topic } from "./types";
import { Live } from "./ui";
import { Home } from "./Home";
import { TopicPage } from "./TopicPage";
import { Wizard } from "./Wizard";
import paper from "./themes/packs/editorial-paper.json";
import slate from "./themes/packs/cool-slate.json";
import night from "./themes/packs/obsidian-night.json";
declare const __ALTHING_CSS__: string;
const themes = [paper, slate, night];
const art = [
  "council",
  "owl",
  "research",
  "report",
  "winged-book",
].map((n) => n + ".webp");

function App({
  api,
  surface,
  container,
  rpc,
}: {
  api: HostApi;
  surface: Surface;
  container: HTMLElement;
  rpc: RpcClient;
}) {
  const [locale, setLocale] = useState(api.locale || "en"),
    [scheme, setScheme] = useState(api.colorScheme || "light"),
    [selected, setSelected] = useState("auto");
  const [settingsReady, ready] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({}),
    [assets, setAssets] = useState<Record<string, string>>({}),
    [cards, setCards] = useState<Card[]>([]),
    [workspaces, setWorkspaces] = useState<Project[]>([]),
    [connected, setConnected] = useState(false);
  const [dest, go] = useState<Destination>(surface.initial || {}),
    [cwd, setCwd] = useState(surface.initial?.projectCwd || ""),
    [wizard, show] = useState(!!surface.initial?.newCouncil),
    [topic, setTopic] = useState<Topic>(),
    [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    lock = useRef(false),
    [version, refresh] = useReducer((n: number) => n + 1, 0);
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [dest.topicId]);
  const l = useCallback(
    (en: string, zh: string) => (locale.startsWith("zh") ? zh : en),
    [locale],
  );
  const navigate = useCallback((d: Destination) => {
    go(d);
    if (d.projectCwd !== undefined) setCwd(d.projectCwd);
    show(!!d.newCouncil);
    setError("");
  }, []);
  useEffect(() => {
    const onNav = (e: Event) =>
      navigate((e as CustomEvent<Destination>).detail);
    container.addEventListener("althing:navigate", onNav);
    const appearance = listenAppearance(
      api,
      container.ownerDocument,
      (lang, s) => {
        setLocale(lang);
        setScheme(s);
      },
    );
    let live = true,
      updated = false;
    function apply(s: Record<string, unknown>) {
      if (live) {
        ready(true);
        setSettings(s);
        setSelected(String(s.defaultTheme || "auto"));
      }
    }
    const off = api.storage.onChange((s) => {
      updated = true;
      apply(s);
    });
    api.storage
      .get()
      .then((s) => {
        if (!updated) apply(s);
      })
      .catch((e) => {
        if (live) {
          ready(true);
          setError(e.message);
        }
      });
    Promise.all(
      art.map(async (name) => {
        const path = "assets/art/" + name;
        const asset = api.assets.url
          ? await api.assets.url(path)
          : await api.assets.readDataUrl!(path);
        return [name, typeof asset === "string" ? asset : asset.dataUrl];
      }),
    )
      .then((v) => {
        if (live) setAssets(Object.fromEntries(v));
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    const ctrl = new AbortController();
    watchEvents(rpc, container.ownerDocument, ctrl.signal, refresh);
    return () => {
      live = false;
      appearance();
      off();
      ctrl.abort();
      container.removeEventListener("althing:navigate", onNav);
    };
  }, [api, surface, container, rpc, navigate]);
  useEffect(() => {
    let live = true;
    async function inventory() {
      const status = rpc
        .call<{ connected: boolean }>("codexhost/status")
        .then((s) => {
          if (live) setConnected(s.connected);
        });
      const paths = async () => {
        let offset = 0;
        const all: Project[] = [];
        do {
          const p = await rpc.call<{
            projects: Project[];
            nextOffset?: number | null;
          }>("codexhost/projects", { offset });
          all.push(...p.projects);
          if (!p.nextOffset || p.nextOffset <= offset) break;
          offset = p.nextOffset;
        } while (live);
        if (live) setWorkspaces(all);
      };
      await Promise.allSettled([status, paths()]);
    }
    void inventory();
    return () => {
      live = false;
    };
  }, [rpc, wizard]);
  useEffect(() => {
    let live = true;
    rpc
      .call<Card[]>("topics/list")
      .then((c) => {
        if (live) setCards(c);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [rpc, version]);
  useEffect(() => {
    let live = true;
    if (dest.topicId)
      Promise.all([
        rpc.call<Topic>("topics/get", { topicId: dest.topicId }),
        rpc.call<Run[]>("council/runs", { topicId: dest.topicId }),
      ])
        .then(([t, r]) => {
          if (live) {
            setTopic(t);
            setRuns(r);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [rpc, version, dest.topicId]);
  async function perform(action: () => Promise<unknown>) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      refresh();
      return true;
    } catch (e) {
      if (!rpc.signal?.aborted) setError((e as Error).message);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const projects = useMemo(() => {
    const all = new Map<string, Project>();
    for (const p of [
      ...cards.map((c) => ({
        cwd: c.projectCwd,
        name: c.projectLabel || c.projectCwd,
      })),
      ...(surface.projects?.() || []),
      ...workspaces,
    ])
      if (p.cwd) all.set(workspaceKey(p.cwd), p);
    if (cwd && !all.has(workspaceKey(cwd)))
      all.set(workspaceKey(cwd), { cwd, name: cwd });
    return [...all.values()];
  }, [workspaces, cards, surface, cwd, wizard]);
  const theme =
    themes.find((t) => t.id === selected) ||
    (scheme === "dark" ? night : paper);
  return (
    <LocaleContext.Provider value={l}>
      <AssetContext.Provider value={assets}>
        <WorkspaceContext.Provider
          value={{
            rpc,
            settings,
            projects,
            runs,
            surface,
            navigate,
            refresh,
            perform,
            busy,
            scheme: theme.scheme,
            error,
          }}
        >
          <div
            className="althing-ext-root"
            ref={viewport}
            lang={locale}
            data-theme={theme.id}
            style={
              {
                ...Object.fromEntries(
                  Object.entries(theme.tokens).map(([k, v]) => ["--" + k, v]),
                ),
                colorScheme: theme.scheme,
              } as CSSProperties
            }
          >
            <header className="global">
              <div className="global-inner">
                <button className="brand" onClick={() => navigate({})}>
                  {assets["owl.webp"] && (
                    <img src={assets["owl.webp"]} alt="" />
                  )}
                  {l("The Althing", "议事厅")}
                </button>
                <div className="tools">
                  <Live on={connected} />
                  <label className="theme">
                    <select
                      aria-label={l("Theme", "主题")}
                      value={selected}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      <option value="auto">
                        {l("System theme", "跟随系统")}
                      </option>
                      {themes.map((t, i) => (
                        <option key={t.id} value={t.id}>
                          {l(t.name, ["编辑纸页", "冷色青灰", "曜石之夜"][i])}
                        </option>
                      ))}
                    </select>
                  </label>
                  {surface.close && (
                    <button onClick={surface.close}>
                      {l("Back to chat", "返回聊天")}
                    </button>
                  )}
                </div>
              </div>
            </header>
            {error && (
              <aside role="alert" className="problem">
                {error}
                <button onClick={() => setError("")}>
                  {l("Dismiss", "关闭")}
                </button>
              </aside>
            )}
            {dest.topicId ? (
              topic?.id === dest.topicId ? (
                <TopicPage
                  key={JSON.stringify(dest)}
                  topic={topic}
                  initial={dest}
                />
              ) : (
                <p role="status">{l("Loading council…", "正在加载议题…")}</p>
              )
            ) : (
              <Home
                cards={cards}
                cwd={cwd}
                setCwd={setCwd}
                create={() => show(true)}
              />
            )}
            {wizard && settingsReady && (
              <Wizard cwd={cwd} close={() => show(false)} />
            )}
          </div>
        </WorkspaceContext.Provider>
      </AssetContext.Provider>
    </LocaleContext.Provider>
  );
}
export function mountWorkspace(
  root: HTMLElement,
  api: HostApi,
  surface: Surface = {},
  signal = api.signal,
) {
  if (signal.aborted || api.signal.aborted) return () => {};
  const host = root.ownerDocument.createElement("div");
  root.append(host);
  const shadow = host.attachShadow({ mode: "open" }),
    style = root.ownerDocument.createElement("style"),
    content = root.ownerDocument.createElement("div");
  // Carry the host panel's available height through the shadow boundary.
  style.textContent = ":host { display: block; min-width: 0; height: 100% }" + __ALTHING_CSS__;
  content.style.height = "100%";
  shadow.append(style, content);
  const react = createRoot(content),
    controller = new AbortController();
  react.render(
    <App
      api={api}
      surface={surface}
      container={root}
      rpc={new RpcClient(api.backend, controller.signal)}
    />,
  );
  function dispose() {
    if (controller.signal.aborted) return;
    controller.abort();
    react.unmount();
    host.remove();
    signal.removeEventListener("abort", dispose);
    api.signal.removeEventListener("abort", dispose);
  }
  api.signal.addEventListener("abort", dispose, { once: true });
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
