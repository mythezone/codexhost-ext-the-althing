export function MarbleGate() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 130 96"
      fill="none"
      className="venue-gate-art"
    >
      <ellipse cx="67" cy="91" rx="55" ry="4" fill="#28445c" opacity=".14" />
      <g
        stroke="#244260"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M22 79V29l43-19 43 19v50" fill="#f0f7fa" />
        <path d="M44 76V51a21 21 0 0 1 42 0v25Z" fill="#376381" />
        <path
          className="venue-door-light"
          d="M50 76V52a15 15 0 1 1 30 0v24"
          fill="#a2dcff"
          stroke="#8bc5ea"
        />
        <path d="m55 64 9-10m1 11 9-11" stroke="white" opacity=".75" />
        {[30, 91].map((x) => (
          <g key={x}>
            <path d={`M${x} 78l2-43h6l2 43Z`} fill="#fff9df" />
            <path d={`M${x + 5} 41v31`} stroke="#b9c7cf" strokeWidth="1.5" />
            <rect
              x={x - 3}
              y="30"
              width="16"
              height="6"
              rx="2"
              fill="#f9dc8d"
            />
            <rect
              x={x - 3}
              y="75"
              width="16"
              height="6"
              rx="2"
              fill="#e9edf0"
            />
          </g>
        ))}
        <path d="m13 30 52-25 53 25-3 4H16Z" fill="#fff4c6" />
        <path d="m25 27 40-17 39 17Z" fill="#eaf5fd" />
        <path d="m62 22 3-6 3 6-3 2Z" fill="#ffd25b" strokeWidth="1.5" />
        <path d="M20 80h91l3 5H17Zm-6 5h102l3 5H11Z" fill="#f6fbff" />
      </g>
    </svg>
  );
}

export function GardenGate() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 130 96"
      fill="none"
      className="venue-gate-art"
    >
      <ellipse cx="65" cy="91" rx="48" ry="4" fill="#173f43" opacity=".3" />
      <g
        stroke="#224f54"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M32 82V47c0-26 20-37 33-42 16 6 34 18 34 42v35H86V48c0-18-10-27-21-32-11 6-21 15-21 32v34Z"
          fill="#a2ddbf"
        />
        <path
          className="venue-door-light"
          d="M46 81V49c0-13 6-23 19-31 14 8 20 18 20 31v32Z"
          fill="#a3c9e6"
        />
        <path
          d="M65 20v60M47 49q18-2 18-20 1 18 19 20"
          stroke="#6585a2"
          strokeWidth="2"
        />
        <path
          d="M37 76q10-26-1-37m59 31q-9-24 0-39"
          stroke="#437f67"
          strokeWidth="3"
        />
        {[
          [32, 58, -25],
          [41, 49, 30],
          [37, 34, -23],
          [91, 56, 24],
          [93, 43, -24],
          [87, 25, 15],
        ].map(([x, y, a]) => (
          <ellipse
            key={x + "," + y}
            cx={x}
            cy={y}
            rx="4"
            ry="8"
            transform={`rotate(${a} ${x} ${y})`}
            fill="#7dc18e"
          />
        ))}
        <path
          d="m64 4 2-4 3 4 4 2-4 2-3 5-2-5-5-2Z"
          fill="#ffe49a"
          strokeWidth="1.6"
        />
        <path d="M28 79h75l4 6H24Zm-7 6h89l4 5H17Z" fill="#f1dfb6" />
      </g>
    </svg>
  );
}

export function RoundTable({ garden = false }: { garden?: boolean }) {
  const ink = garden ? "#31565d" : "#496887",
    edge = garden ? "#9ac8ac" : "#d0e0ee",
    band = garden ? "#507a6a" : "#91b6d5";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 480 180"
      preserveAspectRatio="none"
      className="venue-table-art"
    >
      <ellipse
        cx="240"
        cy="151"
        rx="221"
        ry="22"
        fill="#263c60"
        opacity=".16"
      />
      <path
        d="m66 84 12 53c23 34 299 46 328-2l9-51Z"
        fill={band}
        stroke={ink}
        strokeWidth="2.5"
      />
      <ellipse
        cx="240"
        cy="120"
        rx="176"
        ry="38"
        fill={edge}
        stroke={ink}
        strokeWidth="2"
      />
      <path
        d="M10 69v14c0 84 460 84 460 0V69"
        fill={edge}
        stroke={ink}
        strokeWidth="2.5"
      />
      <ellipse
        cx="240"
        cy="69"
        rx="230"
        ry="65"
        fill={garden ? "#ddedce" : "#fff8df"}
        stroke={ink}
        strokeWidth="2.5"
      />
      <ellipse
        cx="240"
        cy="68"
        rx="213"
        ry="55"
        fill={garden ? "#c2e6d4" : "#fffdf6"}
        stroke={garden ? "#84b89a" : "#d4b365"}
        strokeWidth="2"
      />
      <ellipse
        cx="240"
        cy="68"
        rx="184"
        ry="43"
        fill="none"
        stroke={garden ? "#99c5ab" : "#e7d9ab"}
        strokeDasharray={garden ? "3 5" : "8 5"}
        strokeWidth="2"
      />
      <path
        d="M80 131q159 49 320 0"
        stroke="white"
        strokeWidth="2"
        opacity=".7"
        fill="none"
      />
    </svg>
  );
}

export function GardenTable() {
  return <RoundTable garden />;
}
