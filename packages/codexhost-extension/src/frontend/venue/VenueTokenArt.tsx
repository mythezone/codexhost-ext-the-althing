import type { ReactNode } from "react";

/** Keeps the hit area still while the illustration and its highlights move. */
export function VenueTokenArt({ children }: { children: ReactNode }) {
  return (
    <span className="venue-token-art">
      {children}
      <svg
        className="venue-glints"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          className="glint-leading"
          d="m13 22 2-6 2 6 6 2-6 2-2 6-2-6-6-2z"
        />
        <path
          className="glint-trailing"
          d="m81 9 2-5 2 5 5 2-5 2-2 5-2-5-5-2z"
        />
        <circle className="glint-dot" cx="92" cy="32" r="2.3" />
      </svg>
    </span>
  );
}
