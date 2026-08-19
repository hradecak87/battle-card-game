import { UnitType } from '@/lib/cards/types'
import { UNIT_ART_THEME } from '@/lib/cards/unit-art-theme'

/**
 * Renders a themed background panel + a hand-drawn SVG emblem representing
 * the given unit type. Purely presentational (no external image assets —
 * this project has no image-generation tool available, so unit art is
 * hand-authored vector iconography instead of illustrated artwork).
 *
 * `variant="figure"` is a design proof-of-concept for a full standing
 * character (currently only implemented for archers) instead of a
 * symbolic emblem — use to compare styles before deciding which to use
 * for all 8 unit types.
 */
export function UnitArt({
  unitType,
  variant = 'emblem',
}: {
  unitType: UnitType
  variant?: 'emblem' | 'figure'
}) {
  const theme = UNIT_ART_THEME[unitType]

  return (
    // The gradient background fills the full (non-square) art panel via CSS
    // so it always covers edge-to-edge. The emblem itself is a separate
    // square-viewBox SVG centered on top — keeping it centered/undistorted
    // no longer letterboxes the background too (that was the previous bug).
    <div
      className="w-full h-full"
      style={{
        background: `radial-gradient(ellipse at 50% 45%, ${theme.gradientFrom} 0%, ${theme.gradientTo} 100%)`,
      }}
    >
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={unitType}
      >
        <g stroke={theme.accent} fill="none" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
          {variant === 'figure' && unitType === 'archers' ? (
            <ArcherFigure accent={theme.accent} />
          ) : (
            <Emblem unitType={unitType} accent={theme.accent} />
          )}
        </g>
      </svg>
    </div>
  )
}

function ArcherFigure({ accent }: { accent: string }) {
  return (
    <>
      {/* head */}
      <circle cx="54" cy="20" r="6.5" strokeWidth={3} />
      {/* torso */}
      <line x1="54" y1="26.5" x2="49" y2="56" strokeWidth={4} />
      {/* legs, slight stance */}
      <line x1="49" y1="56" x2="38" y2="88" strokeWidth={4} />
      <line x1="49" y1="56" x2="61" y2="86" strokeWidth={4} />
      {/* front arm holding the bow */}
      <line x1="52" y1="36" x2="28" y2="36" strokeWidth={3.5} />
      {/* back arm drawing the string to the cheek */}
      <line x1="51" y1="34" x2="68" y2="30" strokeWidth={3.5} />
      {/* bow */}
      <path d="M28,12 Q14,36 28,60" strokeWidth={3} />
      <line x1="28" y1="12" x2="28" y2="60" strokeWidth={1.2} />
      {/* drawn arrow: nocked on the string, tip toward the bow */}
      <line x1="68" y1="30" x2="24" y2="34" strokeWidth={2} />
      <polyline points="32,30 24,34 32,38" />
      <polyline points="62,26 68,30 63,34" fill={accent} />
    </>
  )
}

function Emblem({ unitType, accent }: { unitType: UnitType; accent: string }) {
  switch (unitType) {
    case 'archers':
      return (
        <>
          {/* bow */}
          <path d="M32,18 Q14,50 32,82" />
          <line x1="32" y1="18" x2="32" y2="82" strokeWidth={1.5} />
          {/* arrow */}
          <line x1="20" y1="50" x2="82" y2="50" />
          <polyline points="72,42 84,50 72,58" />
          <polyline points="20,44 12,50 20,56" fill={accent} />
        </>
      )
    case 'crossbowmen':
      return (
        <>
          <line x1="14" y1="38" x2="86" y2="38" />
          <line x1="50" y1="38" x2="50" y2="75" />
          <rect x="42" y="70" width="16" height="10" rx="2" />
          <line x1="50" y1="15" x2="50" y2="38" />
          <polyline points="43,25 50,15 57,25" />
        </>
      )
    case 'spearmen':
      return (
        <>
          <ellipse cx="38" cy="58" rx="20" ry="26" />
          <line x1="38" y1="34" x2="38" y2="82" strokeWidth={1.5} />
          <line x1="22" y1="58" x2="54" y2="58" strokeWidth={1.5} />
          <line x1="18" y1="86" x2="80" y2="16" />
          <polyline points="68,16 80,16 80,28" fill={accent} />
        </>
      )
    case 'swordsmen':
      return (
        <>
          <line x1="18" y1="18" x2="82" y2="82" />
          <line x1="28" y1="28" x2="18" y2="38" />
          <polyline points="76,76 82,82 76,88" />
          <line x1="82" y1="18" x2="18" y2="82" />
          <line x1="72" y1="28" x2="82" y2="38" />
          <polyline points="24,76 18,82 24,88" />
        </>
      )
    case 'halberdiers':
      return (
        <>
          <line x1="50" y1="12" x2="50" y2="88" />
          <polyline points="43,12 50,2 57,12" />
          <path d="M50,22 Q75,22 72,42 Q68,34 50,36" fill={accent} fillOpacity={0.25} />
          <path d="M50,30 Q30,32 34,48" />
        </>
      )
    case 'knights':
      return (
        <>
          <path d="M28,55 Q28,18 50,15 Q72,18 72,55 Q72,72 50,78 Q28,72 28,55 Z" />
          <line x1="28" y1="46" x2="72" y2="46" />
          <path d="M50,4 Q58,20 50,30 Q42,20 50,4 Z" fill={accent} fillOpacity={0.35} />
        </>
      )
    case 'lightCavalry':
      return (
        <>
          <path d="M22,55 Q22,80 40,80 Q30,80 28,64 Q28,40 50,36 Q66,34 66,48" />
          <circle cx="32" cy="58" r="3.5" fill={accent} stroke="none" />
          <circle cx="60" cy="42" r="3.5" fill={accent} stroke="none" />
          <path d="M50,70 Q66,60 80,68" strokeWidth={4} />
          <polyline points="74,62 80,68 76,74" />
        </>
      )
    case 'siegeEngines':
      return (
        <>
          <line x1="20" y1="85" x2="50" y2="20" />
          <line x1="80" y1="85" x2="50" y2="20" />
          <line x1="20" y1="85" x2="80" y2="85" />
          <line x1="50" y1="30" x2="82" y2="12" />
          <circle cx="86" cy="10" r="5" fill={accent} stroke="none" />
        </>
      )
    case 'settlers':
      return (
        <>
          {/* covered wagon body */}
          <path d="M20,62 L20,78 L80,78 L80,62 Q80,50 50,50 Q20,50 20,62 Z" />
          {/* wheels */}
          <circle cx="32" cy="80" r="8" />
          <circle cx="68" cy="80" r="8" />
          {/* canopy hoop */}
          <path d="M28,52 Q50,30 72,52" />
          {/* pulling pole */}
          <line x1="20" y1="66" x2="6" y2="72" />
        </>
      )
    default:
      return null
  }
}
