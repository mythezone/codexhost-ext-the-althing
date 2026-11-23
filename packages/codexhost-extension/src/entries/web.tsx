import { installCouncilCommand } from "./composer-command";
import { listenAppearance, mountWorkspace, resolveLocale, translate } from "./page";
import type { HostApi } from "../frontend/host";
type Panel = {
  id: string;
  title: { en: string; "zh-CN": string };
  placement: "main";
  render: (root: HTMLElement, signal: AbortSignal) => () => void;
};
export async function activate(
  api: HostApi & {
    dom?: {
      mount(
        parent: HTMLElement,
      ): { container: HTMLElement; dispose(): void } | undefined;
    };
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
  let closeCommand: (() => void) | undefined;
  let hostLocale = api.locale || "en",
    preference: unknown = "auto";
  const offCommand =
    api.dom &&
    installCouncilCommand(
      (commandTopic) => {
        if (closeCommand) return;
        const mount = api.dom!.mount(document.body);
        if (!mount) return;
        mount.container.dataset.althingWebWorkspace = "";
        const close = () => {
          unmount();
          mount.dispose();
          closeCommand = undefined;
        };
        const unmount = mountWorkspace(mount.container, api, {
          initial: { newCouncil: true, commandTopic },
          close,
        });
        closeCommand = close;
      },
      () =>
        translate(
          resolveLocale(hostLocale, preference),
          "Start a council",
          "发起会议",
        ),
    );
  const offAppearance =
    offCommand &&
    listenAppearance(api, document, (lang) => {
      hostLocale = lang;
      offCommand.refreshLabel();
    });
  let disposed = false,
    settingsChanged = false;
  function applySettings(s: Record<string, unknown>) {
    preference = s.language;
    offCommand?.refreshLabel();
  }
  const offSettings =
    offCommand &&
    api.storage.onChange((s) => {
      settingsChanged = true;
      applySettings(s);
    });
  if (offCommand)
    void api.storage
      .get()
      .then((s) => {
        if (!settingsChanged && !disposed) applySettings(s);
      })
      .catch(() => {});
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const close of active) close();
    offAppearance?.();
    offSettings?.();
    offCommand?.();
    closeCommand?.();
    unregister();
    api.signal.removeEventListener("abort", dispose);
  }
  api.track(dispose);
  api.signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
