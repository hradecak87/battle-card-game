'use client'

export type DiplomacyTabKey = 'wars' | 'peace' | 'coalition' | 'pacts' | 'loans'

interface DiplomacyTabsProps {
  activeTab: DiplomacyTabKey
  onChange: (tab: DiplomacyTabKey) => void
}

const TABS: Array<{ key: DiplomacyTabKey; label: string }> = [
  { key: 'wars', label: 'Moje války' },
  { key: 'peace', label: 'Nabídky míru' },
  { key: 'coalition', label: 'Koalice' },
  { key: 'pacts', label: 'Pakty' },
  { key: 'loans', label: 'Půjčky' },
]

export function DiplomacyTabs({ activeTab, onChange }: DiplomacyTabsProps) {
  return (
    <div className="inline-flex flex-wrap rounded-xl bg-zinc-900 p-1" data-testid="diplomacy-tabs">
      {TABS.map((tab) => {
        const active = tab.key === activeTab
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              active ? 'bg-amber-600 text-white' : 'text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
