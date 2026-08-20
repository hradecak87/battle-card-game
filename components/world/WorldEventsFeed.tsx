import Link from 'next/link'
import type { ReactNode } from 'react'
import type { WorldEventRow } from '@/lib/world/api'

interface WorldEventsFeedProps {
  events: WorldEventRow[]
  page: number
  pageSize: number
  totalCount: number
  onPageChange: (page: number) => void
  now?: Date
}

function asNumber(value: unknown) {
  return typeof value === 'number' ? value : null
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function mapLink(label: string, x: unknown, y: unknown) {
  const xNumber = asNumber(x)
  const yNumber = asNumber(y)
  if (xNumber === null || yNumber === null) {
    return <span>{label}</span>
  }

  return (
    <Link href={`/map?x=${xNumber}&y=${yNumber}`} className="underline">
      {label}
    </Link>
  )
}

export function formatWorldEventText(event: WorldEventRow) {
  const payload = event.payload

  switch (event.event_type) {
    case 'attack_declared':
      return `${asString(payload.attacker_display_name) ?? 'Někdo'} zahájil tažení na území (${asNumber(payload.territory_x) ?? '?'}, ${asNumber(payload.territory_y) ?? '?'})`
    case 'territory_claimed':
      return `${asString(payload.player_display_name) ?? 'Někdo'} obsadil území (${asNumber(payload.territory_x) ?? '?'}, ${asNumber(payload.territory_y) ?? '?'})`
    case 'battle_won': {
      const winner = asString(payload.winner_display_name) ?? 'Někdo'
      const loser = asString(payload.loser_display_name)
      const territory = `(${asNumber(payload.territory_x) ?? '?'}, ${asNumber(payload.territory_y) ?? '?'})`
      return loser ? `${winner} vyhrál bitvu nad ${loser} o území ${territory}` : `${winner} vyhrál bitvu o území ${territory}`
    }
    case 'battle_surrendered':
      return `${asString(payload.loser_display_name) ?? 'Někdo'} se vzdal v bitvě o území (${asNumber(payload.territory_x) ?? '?'}, ${asNumber(payload.territory_y) ?? '?'}) (${asString(payload.winner_display_name) ?? 'Někdo'} vyhrál)`
    case 'territory_abandoned':
      return `${asString(payload.player_display_name) ?? 'Někdo'} se vzdal území (${asNumber(payload.territory_x) ?? '?'}, ${asNumber(payload.territory_y) ?? '?'})`
    case 'attack_recalled':
      return `${asString(payload.attacker_display_name) ?? 'Někdo'} odvolal útok na území (${asNumber(payload.territory_x) ?? '?'}, ${asNumber(payload.territory_y) ?? '?'})`
    case 'king_relocated':
      return `${asString(payload.player_display_name) ?? 'Někdo'} přenesl královské sídlo na území (${asNumber(payload.new_home_x) ?? '?'}, ${asNumber(payload.new_home_y) ?? '?'})`
    case 'player_leveled_up':
      return `${asString(payload.player_display_name) ?? 'Někdo'} dosáhl levelu ${asNumber(payload.new_level) ?? '?'}`
    case 'player_joined':
      return `${asString(payload.player_display_name) ?? 'Někdo'} se připojil do hry`
    default:
      return 'Ve světě se stalo něco nového.'
  }
}

function formatRelativeTime(targetIso: string, now: Date = new Date()) {
  const diffMs = now.getTime() - new Date(targetIso).getTime()
  if (diffMs <= 60_000) return 'právě teď'

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `před ${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `před ${hours} h`

  const days = Math.floor(hours / 24)
  return `před ${days} d`
}

function renderEventText(event: WorldEventRow): ReactNode {
  const payload = event.payload
  const territoryLink = mapLink(
    `Území (${asNumber(payload.territory_x) ?? asNumber(payload.new_home_x) ?? '?'}, ${asNumber(payload.territory_y) ?? asNumber(payload.new_home_y) ?? '?'})`,
    asNumber(payload.territory_x) ?? asNumber(payload.new_home_x),
    asNumber(payload.territory_y) ?? asNumber(payload.new_home_y)
  )

  switch (event.event_type) {
    case 'attack_declared':
      return (
        <>
          {mapLink(
            asString(payload.attacker_display_name) ?? 'Někdo',
            payload.attacker_home_x,
            payload.attacker_home_y
          )}{' '}
          zahájil tažení na {territoryLink}
        </>
      )
    case 'territory_claimed':
      return (
        <>
          {mapLink(
            asString(payload.player_display_name) ?? 'Někdo',
            payload.player_home_x,
            payload.player_home_y
          )}{' '}
          obsadil {territoryLink}
        </>
      )
    case 'battle_won':
      return (
        <>
          {mapLink(
            asString(payload.winner_display_name) ?? 'Někdo',
            payload.winner_home_x,
            payload.winner_home_y
          )}{' '}
          vyhrál bitvu
          {asString(payload.loser_display_name) ? (
            <>
              {' '}
              nad{' '}
              {mapLink(
                asString(payload.loser_display_name) as string,
                payload.loser_home_x,
                payload.loser_home_y
              )}
            </>
          ) : null}{' '}
          o {territoryLink}
        </>
      )
    case 'battle_surrendered':
      return (
        <>
          {mapLink(
            asString(payload.loser_display_name) ?? 'Někdo',
            payload.loser_home_x,
            payload.loser_home_y
          )}{' '}
          se vzdal v bitvě o {territoryLink} (
          {mapLink(
            asString(payload.winner_display_name) ?? 'Někdo',
            payload.winner_home_x,
            payload.winner_home_y
          )}{' '}
          vyhrál)
        </>
      )
    case 'territory_abandoned':
      return (
        <>
          {mapLink(
            asString(payload.player_display_name) ?? 'Někdo',
            payload.player_home_x,
            payload.player_home_y
          )}{' '}
          se vzdal {territoryLink}
        </>
      )
    case 'attack_recalled':
      return (
        <>
          {mapLink(
            asString(payload.attacker_display_name) ?? 'Někdo',
            payload.attacker_home_x,
            payload.attacker_home_y
          )}{' '}
          odvolal útok na {territoryLink}
        </>
      )
    case 'king_relocated':
      return (
        <>
          {mapLink(
            asString(payload.player_display_name) ?? 'Někdo',
            payload.new_home_x,
            payload.new_home_y
          )}{' '}
          přenesl královské sídlo na {territoryLink}
        </>
      )
    case 'player_leveled_up':
      return (
        <>
          {mapLink(
            asString(payload.player_display_name) ?? 'Někdo',
            payload.player_home_x,
            payload.player_home_y
          )}{' '}
          dosáhl levelu {asNumber(payload.new_level) ?? '?'}
        </>
      )
    case 'player_joined':
      return (
        <>
          {mapLink(
            asString(payload.player_display_name) ?? 'Někdo',
            payload.player_home_x,
            payload.player_home_y
          )}{' '}
          se připojil do hry
        </>
      )
    default:
      return formatWorldEventText(event)
  }
}

export default function WorldEventsFeed({
  events,
  page,
  pageSize,
  totalCount,
  onPageChange,
  now,
}: WorldEventsFeedProps) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
  const isFirstPage = page <= 0
  const isLastPage = page + 1 >= pageCount

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 sm:p-5">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Události ve světě</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={isFirstPage}
            className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-200 disabled:opacity-50"
          >
            Předchozí
          </button>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={isLastPage}
            className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-200 disabled:opacity-50"
          >
            Další
          </button>
          <span className="text-sm text-zinc-400">
            Strana {Math.min(page + 1, pageCount)} / {pageCount}
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-zinc-400">Zatím se nic významného nestalo.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event, index) => (
            <li
              key={`${event.created_at}-${index}`}
              className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-sm text-zinc-200"
            >
              <span>{renderEventText(event)}</span>
              <span className="text-xs text-zinc-400" title={new Date(event.created_at).toLocaleString('cs-CZ')}>
                {formatRelativeTime(event.created_at, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
