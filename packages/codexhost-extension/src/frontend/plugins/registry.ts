import type { ComponentType } from "react";
import type { Topic, Contribution, Report } from "../types";

type Extension = {
  id: string;
  label: (l: (en: string, zh: string) => string) => string;
};
export type TopicTab = Extension & {
  component: ComponentType<{ topic: Topic; configure:()=>void }>;
};
export type ContributionRenderer = Extension & {
  matches: (c: Contribution) => boolean;
  component: ComponentType<{ contribution: Contribution }>;
};
export type ToolbarAction = Extension & {
  component: ComponentType<{ topic: Topic; onPrint: () => void }>;
};
export type ReportWidget = Extension & {
  component: ComponentType<{ report: Report }>;
};
export class PluginRegistry {
  tabs: TopicTab[] = [];
  contributions: ContributionRenderer[] = [];
  actions: ToolbarAction[] = [];
  widgets: ReportWidget[] = [];
  register<K extends "tabs" | "contributions" | "actions" | "widgets">(
    slot: K,
    item: PluginRegistry[K][number],
  ) {
    const entries = this[slot] as Extension[];
    if (entries.some((e) => e.id === item.id))
      throw new Error("Duplicate plugin: " + item.id);
    entries.push(item);
  }
}
export const plugins = new PluginRegistry();
