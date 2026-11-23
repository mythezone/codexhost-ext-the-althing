import type { Backend } from "./rpc-client";
export function workspaceKey(cwd: string) {
  const path = cwd.trim();
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(path))
    return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return path.replace(/\/+$/, "") || path;
}
export function activeCouncil(t: { activeRunCount: number; status: string }) {
  return (
    t.activeRunCount > 0 || ["in_progress", "synthesizing"].includes(t.status)
  );
}
export type Project = { cwd: string; name: string };
export type Destination = {
  topicId?: string;
  projectCwd?: string;
  newCouncil?: boolean;
  commandTopic?: string;
  tab?: string;
  sub?: string;
  reportId?: string;
};
export type HostApi = {
  signal: AbortSignal;
  backend: Backend;
  storage: {
    get(): Promise<Record<string, unknown>>;
    onChange(fn: (s: Record<string, unknown>) => void): () => void;
  };
  assets: {
    url?: (path: string) => string | Promise<string>;
    readDataUrl?: (
      path: string,
    ) => Promise<{ dataUrl: string; mimeType: string }>;
  };
  locale?: string;
  colorScheme?: string;
  onLocaleChange?: (fn: (s: string) => void) => () => void;
  onColorSchemeChange?: (fn: (s: string) => void) => () => void;
};
export type Surface = {
  initial?: Destination;
  projects?: () => Project[];
  openThread?: (id: string) => Promise<void>;
  close?: () => void;
};
// Some Host APIs expose the activation-time locale and deliver later choices through events.
const reportedLocale = new WeakMap<HostApi, string>();
export function listenAppearance(
  api: HostApi,
  doc: Document,
  update: (locale: string, scheme: string) => void,
) {
  const html = doc.documentElement,
    media = doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)");
  let locale = reportedLocale.get(api) ?? api.locale,
    scheme = api.colorScheme;
  const apply = () => {
    const cssScheme = doc.defaultView?.getComputedStyle(doc.body).colorScheme;
    const native = html.classList.contains("dark")
      ? "dark"
      : html.classList.contains("light")
        ? "light"
        : cssScheme === "light" || cssScheme === "dark"
          ? cssScheme
          : media?.matches
            ? "dark"
            : "light";
    update(locale || html.lang || "en", scheme || native);
  };
  const obs = new MutationObserver(apply);
  obs.observe(html, {
    attributes: true,
    attributeFilter: ["lang", "class", "style"],
  });
  media?.addEventListener("change", apply);
  const offLocale = api.onLocaleChange?.((s) => {
      reportedLocale.set(api, s);
      locale = s;
      apply();
    }),
    offScheme = api.onColorSchemeChange?.((s) => {
      scheme = s;
      apply();
    });
  apply();
  return () => {
    obs.disconnect();
    offLocale?.();
    offScheme?.();
    media?.removeEventListener("change", apply);
  };
}
