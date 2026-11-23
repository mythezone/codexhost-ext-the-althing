import type { ComponentType } from "react";
import { GardenGate, GardenTable, MarbleGate, RoundTable } from "./scenery";

export type VenueStyle = {
  id: string;
  name: string;
  backdrop: string;
  sky: string;
  accent: string;
  Door: ComponentType;
  Table: ComponentType;
  /** CSS percentage coordinates in the hall, in reading/tab order. */
  doorPositions: readonly (readonly [number, number])[];
};
export type Portrait = { id: string; name: string; image: string };
export type VenuePlugin = { venues?: VenueStyle[]; portraits?: Portrait[] };

const corners = [
  [18, 24],
  [82, 24],
  [18, 72],
  [82, 72],
] as const;
const builtin: VenuePlugin = {
  venues: [
    {
      id: "olympus",
      name: "奥林匹斯白厅",
      backdrop: "venue-olympus.webp",
      accent: "#24599b",
      sky: "#dfedfa",
      Door: MarbleGate,
      Table: RoundTable,
      doorPositions: corners,
    },
    {
      id: "starlit-garden",
      name: "星光植物园",
      backdrop: "venue-garden.webp",
      accent: "#276855",
      sky: "#ceded9",
      Door: GardenGate,
      Table: GardenTable,
      doorPositions: [
        [21, 23],
        [79, 23],
        [17, 74],
        [83, 74],
      ],
    },
  ],
  portraits: [
    { id: "athena", name: "雅典娜", image: "portrait-athena.webp" },
    { id: "hermes", name: "赫尔墨斯", image: "portrait-hermes.webp" },
    { id: "apollo", name: "阿波罗", image: "portrait-apollo.webp" },
    { id: "owl", name: "卷轴猫头鹰", image: "owl.webp" },
  ],
};

const packs = [builtin];
export const venueStyles = packs.flatMap((pack) => pack.venues ?? []);
export const portraits = packs.flatMap((pack) => pack.portraits ?? []);
for (const items of [venueStyles, portraits]) {
  const ids = items.map((item) => item.id);
  if (ids.length !== new Set(ids).size)
    throw new Error("Duplicate council venue or portrait ID");
}
for (const venue of venueStyles) {
  if (!venue.doorPositions.length)
    throw new Error("A council venue needs at least one door position");
}
