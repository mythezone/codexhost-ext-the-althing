import { mountWorkspace } from "./page";
import type { HostApi } from "../frontend/host";
type Panel = {
  id: string;
  title: { en: string; "zh-CN": string };
  placement: "main";
  render: (root: HTMLElement, signal: AbortSignal) => () => void;
};
export async function activate(
  api: HostApi & {
    panels: { register: (panel: Panel) => () => void };
    track: (fn: () => void) => void;
  },
) {
  const active = new Set<() => void>();
  const unregister = api.panels.register({
    id: "the-althing",
    title: { en: "The Althing", "zh-CN": "议事厅" },
    placement: "main",
    render(root, signal) {
      const unmount = mountWorkspace(root, api, {}, signal);
      function close() {
        unmount();
        active.delete(close);
        signal.removeEventListener("abort", close);
      }
      if (!signal.aborted) {
        active.add(close);
        signal.addEventListener("abort", close, { once: true });
      }
      return close;
    },
  });
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const close of active) close();
    unregister();
    api.signal.removeEventListener("abort", dispose);
  }
  api.track(dispose);
  api.signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
