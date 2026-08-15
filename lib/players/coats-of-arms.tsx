/**
 * Fixed gallery of hand-authored coat-of-arms SVG shields the player picks
 * from during kingdom onboarding (design spec §4). No image-generation
 * tool is available in this environment, so — like subsystem #1's unit
 * art — these are hand-drawn vector shapes, not illustrated artwork.
 *
 * Every shield shares the same kite-shaped outline (`ShieldOutline`) for a
 * consistent silhouette; each entry then varies the inner pattern and
 * palette so all 20+ options are visually distinct.
 */

import { useId } from 'react'

const SHIELD_PATH = 'M50,4 L92,18 Q92,60 50,96 Q8,60 8,18 Z'

function ShieldOutline({
  fill,
  stroke,
  children,
}: {
  fill: string
  stroke: string
  children?: React.ReactNode
}) {
  // Unique per instance: the gallery renders 20+ of these on one page, so a
  // shared hardcoded clipPath id would collide and only the first shield's
  // clip would apply in the browser.
  const clipId = useId()
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" role="img" aria-label="coat of arms">
      <path d={SHIELD_PATH} fill={fill} stroke={stroke} strokeWidth={3} strokeLinejoin="round" />
      <g clipPath={`url(#${clipId})`}>{children}</g>
      <clipPath id={clipId}>
        <path d={SHIELD_PATH} />
      </clipPath>
    </svg>
  )
}

export interface CoatOfArms {
  id: string
  label: string
  Svg: () => React.JSX.Element
}

export const COATS_OF_ARMS: CoatOfArms[] = [
  {
    id: 'lion-gold',
    label: 'Zlatý lev',
    Svg: () => (
      <ShieldOutline fill="#7f1d1d" stroke="#450a0a">
        <circle cx="50" cy="45" r="18" fill="#facc15" />
        <circle cx="50" cy="45" r="18" fill="none" stroke="#a16207" strokeWidth={2} />
      </ShieldOutline>
    ),
  },
  {
    id: 'cross-white',
    label: 'Bílý kříž',
    Svg: () => (
      <ShieldOutline fill="#1e3a8a" stroke="#1e293b">
        <rect x="42" y="0" width="16" height="100" fill="#f8fafc" />
        <rect x="0" y="38" width="100" height="16" fill="#f8fafc" />
      </ShieldOutline>
    ),
  },
  {
    id: 'stripes-red',
    label: 'Červené pruhy',
    Svg: () => (
      <ShieldOutline fill="#fde68a" stroke="#78350f">
        <rect x="0" y="10" width="100" height="14" fill="#b91c1c" />
        <rect x="0" y="40" width="100" height="14" fill="#b91c1c" />
        <rect x="0" y="70" width="100" height="14" fill="#b91c1c" />
      </ShieldOutline>
    ),
  },
  {
    id: 'chevron-blue',
    label: 'Modrý klín',
    Svg: () => (
      <ShieldOutline fill="#e2e8f0" stroke="#334155">
        <path d="M50,20 L90,70 L70,70 L50,45 L30,70 L10,70 Z" fill="#1d4ed8" />
      </ShieldOutline>
    ),
  },
  {
    id: 'eagle-black',
    label: 'Černý orel',
    Svg: () => (
      <ShieldOutline fill="#fef3c7" stroke="#92400e">
        <path d="M50,25 L65,45 L58,45 L70,70 L50,58 L30,70 L42,45 L35,45 Z" fill="#111827" />
      </ShieldOutline>
    ),
  },
  {
    id: 'diamonds-purple',
    label: 'Fialové kosočtverce',
    Svg: () => (
      <ShieldOutline fill="#f5f3ff" stroke="#4c1d95">
        <path d="M50,10 70,40 50,70 30,40 Z" fill="#6d28d9" />
        <path d="M50,45 70,75 50,105 30,75 Z" fill="#6d28d9" />
      </ShieldOutline>
    ),
  },
  {
    id: 'sun-orange',
    label: 'Oranžové slunce',
    Svg: () => (
      <ShieldOutline fill="#082f49" stroke="#0c4a6e">
        <circle cx="50" cy="45" r="16" fill="#f97316" />
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (i * Math.PI) / 4
          const x2 = 50 + Math.cos(angle) * 30
          const y2 = 45 + Math.sin(angle) * 30
          return (
            <line
              key={i}
              x1={50 + Math.cos(angle) * 18}
              y1={45 + Math.sin(angle) * 18}
              x2={x2}
              y2={y2}
              stroke="#f97316"
              strokeWidth={3}
            />
          )
        })}
      </ShieldOutline>
    ),
  },
  {
    id: 'wolf-grey',
    label: 'Šedý vlk',
    Svg: () => (
      <ShieldOutline fill="#f1f5f9" stroke="#334155">
        <path d="M35,55 L45,25 L50,40 L55,25 L65,55 Z" fill="#475569" />
        <circle cx="42" cy="40" r="2.5" fill="#f1f5f9" />
        <circle cx="58" cy="40" r="2.5" fill="#f1f5f9" />
      </ShieldOutline>
    ),
  },
  {
    id: 'tower-brown',
    label: 'Hnědá věž',
    Svg: () => (
      <ShieldOutline fill="#dbeafe" stroke="#1e40af">
        <rect x="38" y="30" width="24" height="45" fill="#78350f" />
        <rect x="34" y="20" width="6" height="12" fill="#78350f" />
        <rect x="60" y="20" width="6" height="12" fill="#78350f" />
        <rect x="47" y="20" width="6" height="12" fill="#78350f" />
      </ShieldOutline>
    ),
  },
  {
    id: 'anchor-navy',
    label: 'Námořní kotva',
    Svg: () => (
      <ShieldOutline fill="#f0fdfa" stroke="#134e4a">
        <line x1="50" y1="18" x2="50" y2="65" stroke="#0f766e" strokeWidth={5} />
        <path d="M30,55 Q50,80 70,55" fill="none" stroke="#0f766e" strokeWidth={5} />
        <line x1="38" y1="30" x2="62" y2="30" stroke="#0f766e" strokeWidth={5} />
      </ShieldOutline>
    ),
  },
  {
    id: 'stars-navy',
    label: 'Hvězdné nebe',
    Svg: () => (
      <ShieldOutline fill="#1e1b4b" stroke="#312e81">
        {[
          [35, 25],
          [65, 30],
          [50, 55],
          [30, 60],
          [70, 65],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3.5} fill="#facc15" />
        ))}
      </ShieldOutline>
    ),
  },
  {
    id: 'axe-crossed',
    label: 'Zkřížené sekery',
    Svg: () => (
      <ShieldOutline fill="#fef2f2" stroke="#7f1d1d">
        <line x1="25" y1="20" x2="75" y2="70" stroke="#57534e" strokeWidth={4} />
        <line x1="75" y1="20" x2="25" y2="70" stroke="#57534e" strokeWidth={4} />
        <path d="M20,15 L32,15 L26,28 Z" fill="#a8a29e" />
        <path d="M80,15 L68,15 L74,28 Z" fill="#a8a29e" />
      </ShieldOutline>
    ),
  },
  {
    id: 'boar-forest',
    label: 'Lesní kanec',
    Svg: () => (
      <ShieldOutline fill="#ecfccb" stroke="#365314">
        <ellipse cx="50" cy="50" rx="22" ry="14" fill="#3f6212" />
        <path d="M30,48 L18,42 L30,42 Z" fill="#3f6212" />
        <path d="M55,42 L60,32 L62,42 Z" fill="#e5e7eb" />
      </ShieldOutline>
    ),
  },
  {
    id: 'castle-grey',
    label: 'Šedý hrad',
    Svg: () => (
      <ShieldOutline fill="#e0f2fe" stroke="#075985">
        <rect x="25" y="45" width="50" height="30" fill="#64748b" />
        <rect x="25" y="35" width="10" height="10" fill="#64748b" />
        <rect x="45" y="35" width="10" height="10" fill="#64748b" />
        <rect x="65" y="35" width="10" height="10" fill="#64748b" />
      </ShieldOutline>
    ),
  },
  {
    id: 'griffin-teal',
    label: 'Gryf',
    Svg: () => (
      <ShieldOutline fill="#f0fdf4" stroke="#065f46">
        <path d="M50,20 L62,45 L54,45 L58,70 L42,70 L46,45 L38,45 Z" fill="#0f766e" />
        <path d="M35,30 L20,35 L35,40 Z" fill="#0f766e" />
        <path d="M65,30 L80,35 L65,40 Z" fill="#0f766e" />
      </ShieldOutline>
    ),
  },
  {
    id: 'rose-pink',
    label: 'Růže',
    Svg: () => (
      <ShieldOutline fill="#fdf2f8" stroke="#831843">
        <circle cx="50" cy="45" r="16" fill="#ec4899" />
        <circle cx="50" cy="45" r="7" fill="#fdf2f8" />
      </ShieldOutline>
    ),
  },
  {
    id: 'hammer-iron',
    label: 'Železné kladivo',
    Svg: () => (
      <ShieldOutline fill="#f5f5f4" stroke="#292524">
        <rect x="46" y="30" width="8" height="45" fill="#57534e" />
        <rect x="34" y="20" width="32" height="16" fill="#a8a29e" stroke="#292524" strokeWidth={2} />
      </ShieldOutline>
    ),
  },
  {
    id: 'wave-blue',
    label: 'Vlny',
    Svg: () => (
      <ShieldOutline fill="#f0f9ff" stroke="#0c4a6e">
        <path d="M10,40 Q25,30 40,40 T70,40 T100,40 V100 H10 Z" fill="#0ea5e9" />
        <path d="M10,60 Q25,50 40,60 T70,60 T100,60 V100 H10 Z" fill="#0284c7" />
      </ShieldOutline>
    ),
  },
  {
    id: 'oak-green',
    label: 'Dubový list',
    Svg: () => (
      <ShieldOutline fill="#fefce8" stroke="#713f12">
        <path d="M50,20 Q65,30 60,50 Q65,65 50,75 Q35,65 40,50 Q35,30 50,20 Z" fill="#166534" />
        <line x1="50" y1="20" x2="50" y2="75" stroke="#14532d" strokeWidth={1.5} />
      </ShieldOutline>
    ),
  },
  {
    id: 'crown-royal',
    label: 'Královská koruna',
    Svg: () => (
      <ShieldOutline fill="#312e81" stroke="#1e1b4b">
        <path d="M28,55 L34,35 L44,48 L50,30 L56,48 L66,35 L72,55 Z" fill="#facc15" />
        <rect x="28" y="55" width="44" height="8" fill="#facc15" />
      </ShieldOutline>
    ),
  },
  {
    id: 'phoenix-crimson',
    label: 'Ohnivý fénix',
    Svg: () => (
      <ShieldOutline fill="#fff7ed" stroke="#7c2d12">
        <path d="M50,18 Q65,35 58,55 Q70,50 75,65 Q60,60 50,80 Q40,60 25,65 Q30,50 42,55 Q35,35 50,18 Z" fill="#dc2626" />
      </ShieldOutline>
    ),
  },
]
