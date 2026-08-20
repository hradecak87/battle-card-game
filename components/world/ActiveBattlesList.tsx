import Link from 'next/link'
import type { ActiveBattleRow } from '@/lib/world/api'

interface ActiveBattlesListProps {
  battles: ActiveBattleRow[]
}

function battleStatusLabel(battle: ActiveBattleRow) {
  return battle.status === 'awaiting_ready' ? 'Čeká na ready' : `Probíhá kolo ${battle.current_round}`
}

export default function ActiveBattlesList({ battles }: ActiveBattlesListProps) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 sm:p-5">
      <h2 className="mb-3 text-lg font-semibold text-zinc-100">Aktivní bitvy</h2>
      {battles.length === 0 ? (
        <p className="text-sm text-zinc-400">Žádné aktivní bitvy.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {battles.map((battle) => (
            <li
              key={battle.battle_id}
              className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-sm text-zinc-200"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center">
                {battle.attacker_home_x !== null && battle.attacker_home_y !== null ? (
                  <Link
                    href={`/map?x=${battle.attacker_home_x}&y=${battle.attacker_home_y}`}
                    className="font-medium text-red-300 underline"
                  >
                    {battle.attacker_display_name}
                  </Link>
                ) : (
                  <span className="font-medium text-red-300">{battle.attacker_display_name}</span>
                )}
                <span className="text-zinc-400">vs.</span>
                {battle.defender_id !== null &&
                battle.defender_display_name &&
                battle.defender_home_x !== null &&
                battle.defender_home_y !== null ? (
                  <Link
                    href={`/map?x=${battle.defender_home_x}&y=${battle.defender_home_y}`}
                    className="font-medium text-sky-300 underline"
                  >
                    {battle.defender_display_name}
                  </Link>
                ) : battle.defender_display_name ? (
                  <span className="font-medium text-sky-300">{battle.defender_display_name}</span>
                ) : (
                  <span className="font-medium text-sky-300">NPC</span>
                )}
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <Link
                  href={`/map?x=${battle.territory_x}&y=${battle.territory_y}`}
                  className="underline text-zinc-100"
                >
                  Území ({battle.territory_x}, {battle.territory_y})
                </Link>
                <span className="text-red-200">{battleStatusLabel(battle)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
