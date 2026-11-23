import { mountWorkspace } from "../frontend/App";
import type { HostApi } from "../frontend/host";
export async function mount(root: HTMLElement, api: HostApi) {
  return mountWorkspace(root, api);
}
export { mountWorkspace };
