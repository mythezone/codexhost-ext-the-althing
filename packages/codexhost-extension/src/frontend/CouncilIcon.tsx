import type { ReactNode } from "react";

// A common outline and a small spot colour, as in the council illustrations.
const drawings = {
  live: (
    <>
      <g stroke="var(--primary)">
        <path d="M6 4a12 12 0 0 0 0 16M18 4a12 12 0 0 1 0 16M8.5 7.5a7 7 0 0 0 0 9m7-9a7 7 0 0 1 0 9" />
        <circle cx="12" cy="12" r="1.7" fill="var(--primary)" />
      </g>
    </>
  ),
  capabilities: (
    <>
      <rect
        x="3"
        y="4"
        width="16"
        height="17"
        rx="2.5"
        fill="var(--icon-paper)"
      />
      <path d="M7 10h6M7 14h8M7 17h5" />
      <path
        d="m18 1 1.5 3.5L23 6l-3.5 1.5L18 11l-1.5-3.5L13 6l3.5-1.5Z"
        fill="var(--sun)"
      />
    </>
  ),
  key: (
    <>
      <path
        d="m11.5 9.6 8.1-6a1.5 1.5 0 0 1 2.1.4l1 1.5a1.4 1.4 0 0 1-.3 1.9L20 9.1l.5 2.3-2.3 1.4-1-2-3.6 2.5a6.4 6.4 0 1 1-2.1-3.7Z"
        fill="var(--sun)"
      />
      <circle cx="7.4" cy="15" r="2" fill="var(--icon-paper)" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="7.5" width="18" height="13" rx="2.2" fill="var(--peach)" />
      <rect
        x="2"
        y="5"
        width="20"
        height="5"
        rx="1.4"
        fill="var(--icon-paper)"
      />
      <rect x="10" y="8.5" width="4" height="4.3" rx=".9" fill="var(--sun)" />
    </>
  ),
  search: (
    <>
      <path d="m15.1 15.1 5.8 5.8" strokeWidth="4.5" />
      <path d="m15.5 15.5 5.5 5.5" stroke="var(--sun)" strokeWidth="1.9" />
      <circle cx="10" cy="10" r="7.2" fill="var(--icon-paper)" />
      <path d="M6.3 10a3.8 3.8 0 0 1 3.8-3.8" stroke="var(--primary)" />
    </>
  ),
  report: (
    <>
      <path
        d="M6.1 2.8h13a1.6 1.6 0 0 1 1.6 1.6V20a1.5 1.5 0 0 1-1.5 1.5H6.1A2.7 2.7 0 0 1 3.4 19V5.5a2.7 2.7 0 0 1 2.7-2.7Z"
        fill="var(--icon-paper)"
      />
      <path d="M13.4 2.8v6.1l2.2-1.5 2.1 1.5V2.8Z" fill="var(--sky)" />
      <path d="M7.2 12.7h9.5m-9.5 3.6h7" />
    </>
  ),
  layers: (
    <>
      <path d="m2 8 10-5 10 5-10 5Z" fill="var(--icon-paper)" />
      <path d="m5.7 10.2-3.7 2L12 17l10-4.8-3.7-2" fill="var(--sky)" />
      <path d="m5.7 14.2-3.7 2L12 21l10-4.8-3.7-2" fill="var(--icon-paper)" />
    </>
  ),
  print: (
    <>
      <rect x="6" y="2.5" width="12" height="6" rx="1.3" fill="var(--sky)" />
      <rect
        x="2"
        y="7"
        width="20"
        height="11"
        rx="2.2"
        fill="var(--icon-paper)"
      />
      <path d="M6 14.5h12v7H6z" fill="var(--icon-paper)" />
      <path d="M8.5 18h7" />
      <circle cx="17.8" cy="10.5" r="1" fill="var(--sun)" />
    </>
  ),
  open: (
    <>
      <rect x="2.2" y="3.1" width="14" height="15" rx="2" fill="var(--sky)" />
      <rect
        x="7"
        y="7"
        width="15"
        height="14"
        rx="2"
        fill="var(--icon-paper)"
      />
      <path d="m11.2 16.8 6.2-6.2m-4.3.1h4.2v4.2" stroke="var(--primary)" />
    </>
  ),
  download: (
    <>
      <path d="M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" fill="var(--sky)" />
      <path d="M12 2v12m-5-5 5 5 5-5" stroke="var(--primary)" strokeWidth="3" />
    </>
  ),
} satisfies Record<string, ReactNode>;
export function CouncilIcon({
  name,
  size = 24,
}: {
  name: keyof typeof drawings;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="council-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--icon-ink)"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {drawings[name]}
    </svg>
  );
}
