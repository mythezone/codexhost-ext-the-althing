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
  let commandContainer: HTMLElement | undefined;
  let hostLocale = api.locale || "en",
    preference: unknown = "auto";
  const offCommand =
    api.dom &&
    installCouncilCommand(
      (cmd) => {
        const initial =
          cmd.prompt && !cmd.custom
            ? {
                convenePrompt: cmd.prompt,
                conveneProtocol: cmd.protocol,
                conveneExpertCount: cmd.expertCount,
              }
            : {
                newCouncil: true,
                commandTopic: cmd.prompt,
                conveneProtocol: cmd.protocol,
                conveneExpertCount: cmd.expertCount,
                customSetup: cmd.custom,
              };
        if (closeCommand && commandContainer) {
          commandContainer.dispatchEvent(
            new CustomEvent("althing:navigate", { detail: initial }),
          );
          return;
        }
        const mount = api.dom!.mount(document.body);
        if (!mount) return;
        mount.container.dataset.althingWebWorkspace = "";
        const close = () => {
          unmount();
          mount.dispose();
          closeCommand = undefined;
          commandContainer = undefined;
        };
        const unmount = mountWorkspace(mount.container, api, {
          initial,
          close,
        });
        closeCommand = close;
        commandContainer = mount.container;
      },
      (instant) =>
        translate(
          resolveLocale(hostLocale, preference),
          instant ? "Press Enter to convene council" : "Start a council",
          instant ? "回车直接召开议会" : "发起会议",
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
