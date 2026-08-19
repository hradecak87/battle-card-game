import { UnitType } from './types'

/**
 * Visual theme (art panel background gradient + emblem accent color) per
 * unit type, used by the TradingCard art panel (components/cards/UnitArt.tsx).
 * Purely presentational — has no effect on game logic.
 */
export interface UnitArtTheme {
  gradientFrom: string
  gradientTo: string
  accent: string
}

export const UNIT_ART_THEME: Record<UnitType, UnitArtTheme> = {
  archers: { gradientFrom: '#1a4d2e', gradientTo: '#0f2818', accent: '#d4af37' },
  crossbowmen: { gradientFrom: '#0f3d3e', gradientTo: '#082527', accent: '#c7d0d3' },
  spearmen: { gradientFrom: '#4a3728', gradientTo: '#2b1f16', accent: '#c9a876' },
  swordsmen: { gradientFrom: '#5c1a1a', gradientTo: '#2e0d0d', accent: '#e0c080' },
  halberdiers: { gradientFrom: '#2f3e46', gradientTo: '#16202a', accent: '#a3b18a' },
  knights: { gradientFrom: '#37474f', gradientTo: '#1c2529', accent: '#dfe6e9' },
  lightCavalry: { gradientFrom: '#6b4f2a', gradientTo: '#3a2a13', accent: '#e8d5a3' },
  siegeEngines: { gradientFrom: '#4b4b4b', gradientTo: '#262626', accent: '#c9c9c9' },
  settlers: { gradientFrom: '#5a4a2f', gradientTo: '#2e2417', accent: '#d9c48a' },
}
