/**
 * Registry of card templates that have real illustrated PNG artwork
 * (960x512, transparent background, under `public/cards/units/`) instead
 * of the default procedural SVG emblem in `unit-art.tsx`.
 *
 * Add a template's id here once its artwork file exists at
 * `public/cards/units/<id>.png`, and `TradingCard` will automatically use
 * the illustration instead of `UnitArt` for that specific card.
 */
const ILLUSTRATED_CARD_IDS: ReadonlySet<string> = new Set([
  'lightCavalry-rare-04',
  'swordsmen-uncommon-08',
  'knights-uncommon-06',
  'crossbowmen-epic-03',
  'swordsmen-uncommon-02',
  'spearmen-rare-02',
  'knights-rare-02',
  'halberdiers-uncommon-02',
  'spearmen-uncommon-02',
  'siegeEngines-uncommon-07',
  'swordsmen-rare-02',
  'siegeEngines-rare-02',
  'knights-uncommon-02',
  'crossbowmen-uncommon-05',
  'lightCavalry-uncommon-02',
  'archers-uncommon-06',
  'lightCavalry-rare-02',
  'archers-rare-03',
  'crossbowmen-rare-02',
  'halberdiers-rare-02',
  'halberdiers-uncommon-01',
  'lightCavalry-uncommon-01',
  'crossbowmen-uncommon-01',
  'knights-uncommon-01',
  'swordsmen-uncommon-01',
])

export function hasIllustratedArt(templateId: string): boolean {
  return ILLUSTRATED_CARD_IDS.has(templateId)
}

export function illustratedArtSrc(templateId: string): string {
  return `/cards/units/${templateId}.png`
}
