import Link from 'next/link'
import { formatEta } from '@/lib/time/formatEta'
import type { ClaimInProgressRow } from '@/lib/world/api'

interface ClaimsInProgressListProps {
  claims: ClaimInProgressRow[]
  now?: Date
}

export default function ClaimsInProgressList({ claims, now }: ClaimsInProgressListProps) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 sm:p-5">
      <h2 className="mb-3 text-lg font-semibold text-zinc-100">Zábory v průběhu</h2>
      {claims.length === 0 ? (
        <p className="text-sm text-zinc-400">Žádné probíhající zábory.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {claims.map((claim) => (
            <li
              key={claim.territory_id}
              className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-sm text-zinc-200"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center">
                  {claim.claimant_home_x !== null && claim.claimant_home_y !== null ? (
                    <Link
                      href={`/map?x=${claim.claimant_home_x}&y=${claim.claimant_home_y}`}
                      className="font-medium text-emerald-300 underline"
                    >
                      {claim.claimant_display_name}
                    </Link>
                  ) : (
                    <span className="font-medium text-emerald-300">{claim.claimant_display_name}</span>
                  )}
                  <span className="text-zinc-400">→</span>
                  <Link
                    href={`/map?x=${claim.territory_x}&y=${claim.territory_y}`}
                    className="underline text-zinc-100"
                  >
                    Území ({claim.territory_x}, {claim.territory_y})
                  </Link>
                </div>
                <span className="text-emerald-200">{formatEta(claim.claim_completes_at, now)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
