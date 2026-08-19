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
  // batch 2 (karty2.png)
  'siegeEngines-uncommon-01',
  'crossbowmen-uncommon-07',
  'swordsmen-epic-04',
  'swordsmen-legend-01',
  'knights-epic-04',
  'siegeEngines-rare-04',
  'siegeEngines-epic-03',
  'siegeEngines-common-03',
  'lightCavalry-common-04',
  'halberdiers-common-04',
  'crossbowmen-common-03',
  'spearmen-common-07',
  'swordsmen-common-08',
  'knights-common-05',
  'siegeEngines-common-05',
  'halberdiers-uncommon-08',
  'lightCavalry-uncommon-06',
  'lightCavalry-epic-04',
  'crossbowmen-common-05',
  'spearmen-epic-02',
  'spearmen-uncommon-03',
  'crossbowmen-uncommon-06',
  'halberdiers-uncommon-03',
  'archers-common-08',
  'spearmen-common-05',
  // batch 3 (karty3.png)
  'knights-common-06',
  'halberdiers-common-07',
  'knights-epic-02',
  'archers-common-05',
  'siegeEngines-common-02',
  'lightCavalry-uncommon-08',
  'settlers-uncommon-08',
  'settlers-rare-06',
  'lightCavalry-legend-02',
  'knights-rare-06',
  'lightCavalry-rare-06',
  'lightCavalry-uncommon-03',
  'settlers-common-06',
  'crossbowmen-uncommon-08',
  'settlers-common-01',
  'spearmen-epic-04',
  'spearmen-uncommon-07',
  'crossbowmen-epic-02',
  'halberdiers-legend-02',
  'spearmen-legend-02',
  'crossbowmen-legend-02',
  'knights-legend-01',
  'archers-legend-02',
  'settlers-legend-02',
  'lightCavalry-legend-01',
])

export function hasIllustratedArt(templateId: string): boolean {
  return ILLUSTRATED_CARD_IDS.has(templateId)
}

export function illustratedArtSrc(templateId: string): string {
  return `/cards/units/${templateId}.png`
}
