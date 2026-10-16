export default function Car({ variant = "blue" }) {
  const blue = variant === "blue";
  const body = blue ? "#81a6bc" : "#d2d9dd";
  return (
    <svg
      className="car-svg"
      viewBox="0 0 200 90"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`body-${variant}`}
          x1="100"
          y1="15"
          x2="100"
          y2="77"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={blue ? "#c3d9e3" : "#f5f7f8"} />
          <stop offset=".48" stopColor={body} />
          <stop offset="1" stopColor={blue ? "#628ba3" : "#b6c2ca"} />
        </linearGradient>
        <filter id={`shadow-${variant}`}>
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity=".2" />
        </filter>
      </defs>
      <g filter={`url(#shadow-${variant})`}>
        <rect x="44" y="12" width="28" height="9" rx="4" fill="#263847" />
        <rect x="132" y="12" width="27" height="9" rx="4" fill="#263847" />
        <rect x="44" y="69" width="28" height="9" rx="4" fill="#263847" />
        <rect x="132" y="69" width="27" height="9" rx="4" fill="#263847" />
        <path
          d="M22 34Q25 20 44 19L151 19Q173 19 180 34L180 55Q176 70 155 71H44Q25 71 22 57Z"
          fill={`url(#body-${variant})`}
          stroke={blue ? "#5a8199" : "#a2b1bc"}
          strokeWidth="1.2"
        />
        <path
          d="M75 24L65 34V56L75 66L119 66L132 55V35L119 24Z"
          fill="#344d60"
        />
        <path d="M81 27L74 35V55L81 63H113L122 55V35L113 27Z" fill={body} />
        <path d="M126 28L136 35V55L126 63L120 57V34Z" fill="#233b4d" />
        <path d="M69 28L59 34V56L69 63L75 55V35Z" fill="#263f52" />
        <path
          d="M139 27L161 28Q168 29 171 34M139 63L161 62Q169 61 171 56"
          stroke="white"
          strokeOpacity=".5"
          strokeWidth="2"
        />
        <path
          d="M32 28L31 36M32 62L31 54"
          stroke="#f8d09a"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M172 30V36M172 55V61"
          stroke="#d56868"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path d="M86 22V19M86 71V68" stroke="#e9f0f4" strokeWidth="2" />
        <path
          d="M54 25H42M54 65H42"
          stroke="white"
          strokeOpacity=".6"
          strokeWidth="2"
        />
        <path
          d="M120 21L126 15L133 15L131 22M120 69L126 75H133L131 68"
          fill={body}
          stroke={blue ? "#5a8199" : "#a2b1bc"}
        />
      </g>
    </svg>
  );
}
