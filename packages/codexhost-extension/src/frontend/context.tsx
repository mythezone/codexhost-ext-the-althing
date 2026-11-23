import { createContext, useContext } from "react";
import type { RpcClient } from "./rpc-client";
import type { Destination, Project, Surface } from "./host";
import type { Run } from "../backend/orchestrator";
export type { Run };
export type Translate = (en: string, zh: string) => string;
export const LocaleContext = createContext<Translate>((en) => en);
export const useL = () => useContext(LocaleContext);
export const AssetContext = createContext<Record<string, string>>({});
export const useAssets = () => useContext(AssetContext);
export type Workspace = {
  rpc: RpcClient;
  settings: Record<string, unknown>;
  projects: Project[];
  runs: Run[];
  surface: Surface;
  navigate: (destination: Destination) => void;
  refresh: () => void;
  perform: (action: () => Promise<unknown>) => Promise<boolean>;
  busy: boolean;
  scheme: string;
  error: string;
};
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw Error("Missing council workspace");
  return context;
}
