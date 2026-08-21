'use client'

import { useMemo, useState } from 'react'
import type {
  CoalitionDetail,
  CoalitionInviteRow,
  CoalitionJoinRequestRow,
  CoalitionMember,
  CoalitionSummary,
} from '@/lib/diplomacy/types'
import { PlayerSearchInput, type PlayerSearchSelection } from '@/components/players/PlayerSearchInput'

type ActionResult = void | boolean | Promise<void | boolean>

interface CoalitionPanelProps {
  myCoalition: CoalitionDetail | null
  coalitions: CoalitionSummary[]
  invites: CoalitionInviteRow[]
  joinRequests: CoalitionJoinRequestRow[]
  currentPlayerId: string
  onCreate: (name: string) => ActionResult
  onRequestJoin: (coalitionId: string) => ActionResult
  onAcceptInvite: (inviteId: string) => ActionResult
  onRejectInvite: (inviteId: string) => ActionResult
  onInvite: (coalitionId: string, playerId: string) => ActionResult
  onAcceptJoinRequest: (requestId: string) => ActionResult
  onRejectJoinRequest: (requestId: string) => ActionResult
  onKickMember: (playerId: string) => ActionResult
  onTransferLeadership: (playerId: string) => ActionResult
  onLeave: () => ActionResult
  onDisband: () => ActionResult
  onDeclareWar: (targetPlayerId: string) => ActionResult
  onDeclarePeace: (targetPlayerId: string) => ActionResult
}

function MemberRow({
  member,
  currentPlayerId,
  isLeader,
  onKick,
  onTransfer,
}: {
  member: CoalitionMember
  currentPlayerId: string
  isLeader: boolean
  onKick: (playerId: string) => ActionResult
  onTransfer: (playerId: string) => ActionResult
}) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span
          className={`h-3 w-3 rounded-full ${member.is_online ? 'bg-emerald-400' : 'bg-zinc-600'}`}
          aria-label={member.is_online ? 'online' : 'offline'}
        />
        <div>
          <p className="font-semibold text-zinc-100">
            {member.display_name}
            {member.player_id === currentPlayerId ? ' (ty)' : ''}
          </p>
          <p className="text-sm text-zinc-400">
            {member.is_leader ? 'Vůdce koalice' : 'Člen koalice'} · Přidal se{' '}
            {new Date(member.joined_at).toLocaleString('cs-CZ')}
          </p>
        </div>
      </div>

      {isLeader && !member.is_leader && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onTransfer(member.player_id)}
            className="rounded-full border border-amber-600 px-3 py-1 text-sm text-amber-200 hover:bg-amber-900/30"
          >
            Předat vedení
          </button>
          <button
            type="button"
            onClick={() => void onKick(member.player_id)}
            className="rounded-full border border-red-700 px-3 py-1 text-sm text-red-300 hover:bg-red-900/30"
          >
            Vyhodit
          </button>
        </div>
      )}
    </li>
  )
}

export function CoalitionPanel({
  myCoalition,
  coalitions,
  invites,
  joinRequests,
  currentPlayerId,
  onCreate,
  onRequestJoin,
  onAcceptInvite,
  onRejectInvite,
  onInvite,
  onAcceptJoinRequest,
  onRejectJoinRequest,
  onKickMember,
  onTransferLeadership,
  onLeave,
  onDisband,
  onDeclareWar,
  onDeclarePeace,
}: CoalitionPanelProps) {
  const [newCoalitionName, setNewCoalitionName] = useState('')
  const [invitePlayer, setInvitePlayer] = useState<PlayerSearchSelection | null>(null)
  const [warTarget, setWarTarget] = useState<PlayerSearchSelection | null>(null)
  const [peaceTarget, setPeaceTarget] = useState<PlayerSearchSelection | null>(null)

  const activeCoalition = myCoalition?.id ? myCoalition : null
  const isLeader = activeCoalition?.leader_id === currentPlayerId
  const pendingInviteCoalitionIds = useMemo(() => new Set(invites.map((invite) => invite.coalition_id)), [invites])

  if (!activeCoalition) {
    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <h3 className="text-lg font-semibold text-zinc-100">Založit vlastní koalici</h3>
          <p className="mt-1 text-sm text-zinc-400">Vymysli název a založ alianci pro ostatní království.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={newCoalitionName}
              onChange={(event) => setNewCoalitionName(event.target.value)}
              placeholder="Název koalice"
              className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            />
            <button
              type="button"
              onClick={async () => {
                if (!newCoalitionName.trim()) return
                const ok = await onCreate(newCoalitionName.trim())
                if (ok !== false) setNewCoalitionName('')
              }}
              className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white"
            >
              ➕ Založit vlastní koalici
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-100">Pozvánky pro tebe</h3>
          {invites.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
              Nemáš žádné čekající pozvánky.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {invites.map((invite) => (
                <article key={invite.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <h4 className="text-lg font-semibold text-zinc-100">{invite.coalition_name}</h4>
                  <p className="text-sm text-zinc-400">
                    Vůdce: {invite.leader_display_name} · Pozval: {invite.invited_by_display_name}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void onAcceptInvite(invite.id)}
                      className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                    >
                      Přijmout pozvánku
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRejectInvite(invite.id)}
                      className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
                    >
                      Odmítnout
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-100">Existující koalice</h3>
          {coalitions.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
              Zatím neexistuje žádná aktivní koalice.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {coalitions.map((coalition) => (
                <article key={coalition.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="text-lg font-semibold text-zinc-100">{coalition.name}</h4>
                      <p className="text-sm text-zinc-400">
                        Vůdce: {coalition.leader_display_name} · Členové: {coalition.member_count}/10
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={pendingInviteCoalitionIds.has(coalition.id)}
                      onClick={() => void onRequestJoin(coalition.id)}
                      className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {pendingInviteCoalitionIds.has(coalition.id) ? 'Čeká pozvánka' : 'Požádat o vstup'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    )
  }

  const coalitionId = activeCoalition.id as string

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-zinc-100">{activeCoalition.name}</h3>
            <p className="text-sm text-zinc-400">
              Vůdce: {activeCoalition.leader_display_name} · Založeno{' '}
              {activeCoalition.created_at ? new Date(activeCoalition.created_at).toLocaleString('cs-CZ') : 'neznámo'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onLeave()}
              className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
            >
              Opustit koalici
            </button>
            {isLeader && (
              <button
                type="button"
                onClick={() => void onDisband()}
                className="rounded-full border border-red-700 px-4 py-2 text-sm text-red-300 hover:bg-red-900/30"
              >
                Rozpustit koalici
              </button>
            )}
          </div>
        </div>
      </section>

      {isLeader && (
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <h4 className="font-semibold text-zinc-100">Pozvat hráče</h4>
            <div className="mt-3 flex flex-col gap-2">
              <PlayerSearchInput value={invitePlayer} onChange={setInvitePlayer} />
              <button
                type="button"
                onClick={async () => {
                  if (!invitePlayer) return
                  const ok = await onInvite(coalitionId, invitePlayer.id)
                  if (ok !== false) setInvitePlayer(null)
                }}
                disabled={!invitePlayer}
                className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Odeslat pozvánku
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <h4 className="font-semibold text-zinc-100">Koaliční válka</h4>
            <div className="mt-3 flex flex-col gap-2">
              <PlayerSearchInput value={warTarget} onChange={setWarTarget} />
              <button
                type="button"
                onClick={async () => {
                  if (!warTarget) return
                  const ok = await onDeclareWar(warTarget.id)
                  if (ok !== false) setWarTarget(null)
                }}
                disabled={!warTarget}
                className="rounded-full bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Vyhlásit válku
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <h4 className="font-semibold text-zinc-100">Koaliční mír</h4>
            <div className="mt-3 flex flex-col gap-2">
              <PlayerSearchInput value={peaceTarget} onChange={setPeaceTarget} />
              <button
                type="button"
                onClick={async () => {
                  if (!peaceTarget) return
                  const ok = await onDeclarePeace(peaceTarget.id)
                  if (ok !== false) setPeaceTarget(null)
                }}
                disabled={!peaceTarget}
                className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Navrhnout mír
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h4 className="text-lg font-semibold text-zinc-100">Členové koalice</h4>
        <ul className="flex flex-col gap-3">
          {activeCoalition.members.map((member) => (
            <MemberRow
              key={member.player_id}
              member={member}
              currentPlayerId={currentPlayerId}
              isLeader={Boolean(isLeader)}
              onKick={onKickMember}
              onTransfer={onTransferLeadership}
            />
          ))}
        </ul>
      </section>

      {isLeader && (
        <section className="space-y-3">
          <h4 className="text-lg font-semibold text-zinc-100">Čekající žádosti o vstup</h4>
          {joinRequests.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
              Nikdo momentálně nečeká na schválení.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {joinRequests.map((request) => (
                <article key={request.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <h5 className="text-lg font-semibold text-zinc-100">{request.player_display_name}</h5>
                  <p className="text-sm text-zinc-400">
                    Požádal {new Date(request.created_at).toLocaleString('cs-CZ')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void onAcceptJoinRequest(request.id)}
                      className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                    >
                      Schválit
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRejectJoinRequest(request.id)}
                      className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
                    >
                      Odmítnout
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
