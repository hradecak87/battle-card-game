import { getAllTemplates, getTemplatesByType } from '@/lib/cards/catalog'
import { applyRank } from '@/lib/cards/combat'
import { TradingCard } from '@/components/cards/TradingCard'
import { RANKS, UNIT_TYPES } from '@/lib/cards/types'

/**
 * TEMPORARY design mockup page — not part of the plan, used only to preview
 * the new TradingCard visual design (rank-colored frames + unit art) before
 * rolling it out across /collection and /arena. Safe to delete once the
 * design is approved and wired into the real pages.
 */
export default function MockupPage() {
  const archerTemplates = getTemplatesByType('archers').slice(0, 5)
  // One example per unit type, cycling through ranks (not just the first/
  // common variant of each) so this section also shows rarity variety —
  // [0] alone would always be common for every type, since the catalog
  // lists common variants first.
  const oneOfEach = UNIT_TYPES.map((ut, i) => {
    const rank = RANKS[i % RANKS.length]
    return getTemplatesByType(ut).find((t) => t.rank === rank) ?? getTemplatesByType(ut)[0]
  })

  // Longest flavorText in the whole 248-card catalog — used below as a
  // worst-case stress test that nothing gets clipped/hidden.
  const longestFlavorTemplate = getAllTemplates().reduce((a, b) =>
    b.flavorText.length > a.flavorText.length ? b : a
  )

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <h1 className="text-2xl font-bold mb-2">Mockup: návrh karet</h1>
      <p className="text-sm text-zinc-400 mb-8">
        Dočasná stránka pro schválení vzhledu — rámečky podle ranku (common
        šedý, uncommon modrý, rare zelený, epic fialový, legend zlatý) a
        vlastní vektorové emblémy podle typu vojska. Karty se nikdy
        nezobrazují užší než 170px (viz `minmax(170px, 1fr)` u mřížky) — při
        této šířce se vejde i nejdelší popisek z celého katalogu (94 znaků,
        viz poslední sekce).
      </p>

      <h2 className="text-lg font-semibold mb-3">Jeden typ (lučištníci) ve všech rancích</h2>
      <div className="grid gap-4 mb-10 max-w-4xl items-stretch grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {archerTemplates.map((t) => (
          <TradingCard key={t.id} template={t} stats={applyRank(t.baseStats, t.rank)} />
        ))}
      </div>

      <h2 className="text-lg font-semibold mb-3">
        Zarovnání statů (krátký vs. dlouhý název, stejná pozice čáry)
      </h2>
      <div className="grid gap-4 mb-10 max-w-xs items-stretch grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {['archers-common-01', 'archers-common-05'].map((id) => {
          const t = archerTemplates.find((x) => x.id === id) ?? archerTemplates[0]
          return <TradingCard key={id} template={t} stats={applyRank(t.baseStats, t.rank)} />
        })}
      </div>

      <h2 className="text-lg font-semibold mb-3">
        Zátěžový test: nejdelší popisek v celém katalogu (94 znaků), na nejužší
        povolené šířce karty (170px)
      </h2>
      <div className="max-w-[170px] mb-10">
        <TradingCard
          template={longestFlavorTemplate}
          stats={applyRank(longestFlavorTemplate.baseStats, longestFlavorTemplate.rank)}
        />
      </div>

      <h2 className="text-lg font-semibold mb-3">
        Jeden příklad z každého typu vojska (různé ranky pro ukázku pestrosti)
      </h2>
      <div className="grid gap-4 max-w-4xl items-stretch grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {oneOfEach.map((t) => (
          <TradingCard key={t.id} template={t} stats={applyRank(t.baseStats, t.rank)} />
        ))}
      </div>
    </main>
  )
}
