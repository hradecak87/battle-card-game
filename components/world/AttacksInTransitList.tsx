import Link from 'next/link'
import { formatEta } from '@/lib/time/formatEta'
import type { AttackInTransitRow } from '@/lib/world/api'

interface AttacksInTransitListProps {
  attacks: AttackInTransitRow[]
  now?: Date
}

export default function AttacksInTransitList({ attacks, now }: AttacksInTransitListProps) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 sm:p-5">
      <h2 className="mb-3 text-lg font-semibold text-zinc-100">Útoky na cestě</h2>
      {attacks.length === 0 ? (
        <p className="text-sm text-zinc-400">Žádné útoky na cestě.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {attacks.map((attack) => (
            <li
              key={attack.movement_id}
              className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-sm text-zinc-200"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center">
                  {attack.attacker_home_x !== null && attack.attacker_home_y !== null ? (
                    <Link
                      href={`/map?x=${attack.attacker_home_x}&y=${attack.attacker_home_y}`}
                      className="font-medium text-amber-300 underline"
                    >
                      {attack.attacker_display_name}
                    </Link>
                  ) : (
                    <span className="font-medium text-amber-300">{attack.attacker_display_name}</span>
                  )}
                  <span className="text-zinc-400">→</span>
                  <Link
                    href={`/map?x=${attack.target_x}&y=${attack.target_y}`}
                    className="underline text-zinc-100"
                  >
                    Území ({attack.target_x}, {attack.target_y})
                  </Link>
                  {attack.target_owner_display_name && (
                    <span className="text-zinc-400">
                      hráče{' '}
                      {attack.target_owner_home_x !== null && attack.target_owner_home_y !== null ? (
                        <Link
                          href={`/map?x=${attack.target_owner_home_x}&y=${attack.target_owner_home_y}`}
                          className="text-zinc-200 underline"
                        >
                          {attack.target_owner_display_name}
                          {attack.target_owner_is_npc ? ' (NPC)' : ''}
                        </Link>
                      ) : (
                        <span className="text-zinc-200">
                          {attack.target_owner_display_name}
                          {attack.target_owner_is_npc ? ' (NPC)' : ''}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <span className="text-amber-200">{formatEta(attack.arrives_at, now)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
