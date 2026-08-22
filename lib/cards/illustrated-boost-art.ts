/**
 * Registry of boost card templates that have real illustrated PNG artwork
 * (transparent background, under `public/cards/boosts/`) instead of the
 * emoji placeholder in NonUnitTradingCard.
 *
 * Add a template's id here once its artwork file exists at
 * `public/cards/boosts/<id>.png`, and `NonUnitTradingCard` will
 * automatically use the illustration instead of the emoji placeholder for
 * that specific card. Not auto-derived from the filesystem — see the same
 * caveat in lib/cards/illustrated-art.ts.
 */
const ILLUSTRATED_BOOST_CARD_IDS: ReadonlySet<string> = new Set([
  'boost-territorial-common-01',
  'boost-offensive-common-01',
  'boost-territorial-common-02',
  'boost-territorial-common-03',
  'boost-offensive-common-02',
  'boost-territorial-uncommon-01',
  'boost-offensive-uncommon-01',
  'boost-territorial-uncommon-02',
  'boost-offensive-uncommon-02',
  'boost-offensive-uncommon-03',
  'boost-territorial-rare-01',
  'boost-offensive-rare-01',
  'boost-offensive-rare-02',
  'boost-territorial-rare-02',
  'boost-territorial-rare-03',
  'boost-territorial-epic-01',
  'boost-offensive-epic-01',
  'boost-territorial-epic-02',
  'boost-offensive-epic-02',
  'boost-offensive-epic-03',
  'boost-territorial-legend-01',
  'boost-offensive-legend-01',
  'boost-territorial-legend-02',
  'boost-territorial-legend-03',
  'boost-offensive-legend-02',
])

export function hasIllustratedBoostArt(templateId: string): boolean {
  return ILLUSTRATED_BOOST_CARD_IDS.has(templateId)
}

export function illustratedBoostArtSrc(templateId: string): string {
  return `/cards/boosts/${templateId}.png`
}
