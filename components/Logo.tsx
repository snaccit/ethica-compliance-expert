/** Compliance-Expert-Logo: abstraktes Symbol (Sechseck mit Funken), ohne Buchstaben. */
export default function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Compliance Expert">
      <defs>
        <linearGradient id="ce-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9b7bff" />
          <stop offset="0.55" stopColor="#6d5dfc" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <radialGradient id="ce-h" cx="0.3" cy="0.25" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M20 3 L34.7 11.5 L34.7 28.5 L20 37 L5.3 28.5 L5.3 11.5 Z" fill="url(#ce-g)" stroke="url(#ce-g)" strokeWidth="4" strokeLinejoin="round" />
      <path d="M20 3 L34.7 11.5 L34.7 28.5 L20 37 L5.3 28.5 L5.3 11.5 Z" fill="url(#ce-h)" />
      <path d="M20 9.5 C21 16.6 23.4 19 30.5 20 C23.4 21 21 23.4 20 30.5 C19 23.4 16.6 21 9.5 20 C16.6 19 19 16.6 20 9.5 Z" fill="#fff" />
      <circle cx="28.6" cy="11.8" r="1.7" fill="#fff" fillOpacity="0.85" />
    </svg>
  );
}
