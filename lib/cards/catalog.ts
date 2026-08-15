import rawCatalogData from './catalog-data.json'
import {
  CardTemplate,
  RANKS,
  Rank,
  SUPPLY_RANGE,
  UNIT_TYPES,
  UnitType,
  VARIANTS_PER_RANK,
} from './types'

const catalogData = rawCatalogData as CardTemplate[]

function validateCatalog(templates: CardTemplate[]): void {
  const expectedTotal = UNIT_TYPES.length * RANKS.reduce((sum, r) => sum + VARIANTS_PER_RANK[r], 0)
  if (templates.length !== expectedTotal) {
    throw new Error(
      `Card catalog validation failed: expected ${expectedTotal} templates, found ${templates.length}`
    )
  }

  const idsSeen = new Set<string>()
  const namesSeen = new Set<string>()
  const countsByTypeRank = new Map<string, number>()

  for (const template of templates) {
    if (idsSeen.has(template.id)) {
      throw new Error(`Card catalog validation failed: duplicate id "${template.id}"`)
    }
    idsSeen.add(template.id)

    if (namesSeen.has(template.name)) {
      throw new Error(`Card catalog validation failed: duplicate name "${template.name}"`)
    }
    namesSeen.add(template.name)

    const key = `${template.unitType}:${template.rank}`
    countsByTypeRank.set(key, (countsByTypeRank.get(key) ?? 0) + 1)

    const { str, lng, def, hp } = template.baseStats
    if (str < 0 || lng < 0 || def < 0 || hp < 0) {
      throw new Error(
        `Card catalog validation failed: negative baseStats on template "${template.id}"`
      )
    }

    if (template.rank === 'common' || template.rank === 'uncommon') {
      if (template.totalSupply !== null) {
        throw new Error(
          `Card catalog validation failed: "${template.id}" (${template.rank}) must have totalSupply=null, got ${template.totalSupply}`
        )
      }
    } else {
      const [min, max] = SUPPLY_RANGE[template.rank as 'rare' | 'epic' | 'legend']
      if (
        template.totalSupply === null ||
        template.totalSupply < min ||
        template.totalSupply > max
      ) {
        throw new Error(
          `Card catalog validation failed: "${template.id}" (${template.rank}) totalSupply must be within [${min}, ${max}], got ${template.totalSupply}`
        )
      }
    }
  }

  for (const unitType of UNIT_TYPES) {
    for (const rank of RANKS) {
      const key = `${unitType}:${rank}`
      const count = countsByTypeRank.get(key) ?? 0
      const expected = VARIANTS_PER_RANK[rank]
      if (count !== expected) {
        throw new Error(
          `Card catalog validation failed: expected ${expected} templates for ${key}, found ${count}`
        )
      }
    }
  }
}

// Validate once, at module load time, so a malformed catalog fails fast
// (build/test time) rather than serving bad data to the UI (spec section 9).
validateCatalog(catalogData)

export function getAllTemplates(): CardTemplate[] {
  return catalogData
}

export function getTemplatesByType(unitType: UnitType): CardTemplate[] {
  return catalogData.filter((t) => t.unitType === unitType)
}

export function getTemplatesByRank(rank: Rank): CardTemplate[] {
  return catalogData.filter((t) => t.rank === rank)
}

export function getTemplateById(id: string): CardTemplate | undefined {
  return catalogData.find((t) => t.id === id)
}
