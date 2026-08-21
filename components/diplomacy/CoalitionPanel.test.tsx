import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CoalitionPanel } from './CoalitionPanel'
import type { CoalitionDetail, CoalitionInviteRow, CoalitionJoinRequestRow, CoalitionSummary } from '@/lib/diplomacy/types'

const noop = jest.fn()

describe('CoalitionPanel', () => {
  it('renders browse/create state with invites for players outside a coalition', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const onAcceptInvite = jest.fn().mockResolvedValue(undefined)
    const coalitions: CoalitionSummary[] = [
      {
        id: 'coalition-1',
        name: 'Jantar',
        leader_id: 'leader-1',
        leader_display_name: 'Vůdce',
        member_count: 3,
      },
    ]
    const invites: CoalitionInviteRow[] = [
      {
        id: 'invite-1',
        coalition_id: 'coalition-1',
        coalition_name: 'Jantar',
        leader_id: 'leader-1',
        leader_display_name: 'Vůdce',
        invited_by: 'leader-1',
        invited_by_display_name: 'Vůdce',
        created_at: '2026-08-21T10:00:00.000Z',
      },
    ]

    render(
      <CoalitionPanel
        myCoalition={null}
        coalitions={coalitions}
        invites={invites}
        joinRequests={[]}
        currentPlayerId="me"
        onCreate={onCreate}
        onRequestJoin={noop}
        onAcceptInvite={onAcceptInvite}
        onRejectInvite={noop}
        onInvite={noop}
        onAcceptJoinRequest={noop}
        onRejectJoinRequest={noop}
        onKickMember={noop}
        onTransferLeadership={noop}
        onLeave={noop}
        onDisband={noop}
        onDeclareWar={noop}
        onDeclarePeace={noop}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Název koalice'), { target: { value: 'Nová koalice' } })
    fireEvent.click(screen.getByRole('button', { name: '➕ Založit vlastní koalici' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Nová koalice'))

    expect(screen.getAllByText('Jantar')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Čeká pozvánka' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Přijmout pozvánku' }))
    await waitFor(() => expect(onAcceptInvite).toHaveBeenCalledWith('invite-1'))
  })

  it('keeps the create input populated when coalition creation fails', async () => {
    const onCreate = jest.fn().mockResolvedValue(false)

    render(
      <CoalitionPanel
        myCoalition={null}
        coalitions={[]}
        invites={[]}
        joinRequests={[]}
        currentPlayerId="me"
        onCreate={onCreate}
        onRequestJoin={noop}
        onAcceptInvite={noop}
        onRejectInvite={noop}
        onInvite={noop}
        onAcceptJoinRequest={noop}
        onRejectJoinRequest={noop}
        onKickMember={noop}
        onTransferLeadership={noop}
        onLeave={noop}
        onDisband={noop}
        onDeclareWar={noop}
        onDeclarePeace={noop}
      />
    )

    const input = screen.getByPlaceholderText('Název koalice') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Neúspěšná koalice' } })
    fireEvent.click(screen.getByRole('button', { name: '➕ Založit vlastní koalici' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Neúspěšná koalice'))
    expect(input.value).toBe('Neúspěšná koalice')
  })

  it('renders member-management controls for coalition leaders', async () => {
    const onInvite = jest.fn().mockResolvedValue(undefined)
    const onDeclareWar = jest.fn().mockResolvedValue(undefined)
    const onAcceptJoinRequest = jest.fn().mockResolvedValue(undefined)
    const onKickMember = jest.fn().mockResolvedValue(undefined)
    const onTransferLeadership = jest.fn().mockResolvedValue(undefined)
    const myCoalition: CoalitionDetail = {
      id: 'coalition-1',
      name: 'Jantar',
      leader_id: 'me',
      leader_display_name: 'Já',
      created_at: '2026-08-21T10:00:00.000Z',
      members: [
        {
          player_id: 'me',
          display_name: 'Já',
          joined_at: '2026-08-21T10:00:00.000Z',
          is_leader: true,
          is_online: true,
        },
        {
          player_id: 'member-2',
          display_name: 'Spojenec',
          joined_at: '2026-08-21T10:05:00.000Z',
          is_leader: false,
          is_online: false,
        },
      ],
    }
    const joinRequests: CoalitionJoinRequestRow[] = [
      {
        id: 'request-1',
        coalition_id: 'coalition-1',
        player_id: 'candidate-1',
        player_display_name: 'Uchazeč',
        created_at: '2026-08-21T10:20:00.000Z',
      },
    ]

    render(
      <CoalitionPanel
        myCoalition={myCoalition}
        coalitions={[]}
        invites={[]}
        joinRequests={joinRequests}
        currentPlayerId="me"
        onCreate={noop}
        onRequestJoin={noop}
        onAcceptInvite={noop}
        onRejectInvite={noop}
        onInvite={onInvite}
        onAcceptJoinRequest={onAcceptJoinRequest}
        onRejectJoinRequest={noop}
        onKickMember={onKickMember}
        onTransferLeadership={onTransferLeadership}
        onLeave={noop}
        onDisband={noop}
        onDeclareWar={onDeclareWar}
        onDeclarePeace={noop}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('ID hráče'), { target: { value: 'candidate-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Odeslat pozvánku' }))
    await waitFor(() => expect(onInvite).toHaveBeenCalledWith('coalition-1', 'candidate-2'))

    fireEvent.change(screen.getAllByPlaceholderText('ID cílového hráče')[0], { target: { value: 'enemy-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vyhlásit válku' }))
    await waitFor(() => expect(onDeclareWar).toHaveBeenCalledWith('enemy-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Schválit' }))
    await waitFor(() => expect(onAcceptJoinRequest).toHaveBeenCalledWith('request-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Vyhodit' }))
    await waitFor(() => expect(onKickMember).toHaveBeenCalledWith('member-2'))

    fireEvent.click(screen.getByRole('button', { name: 'Předat vedení' }))
    await waitFor(() => expect(onTransferLeadership).toHaveBeenCalledWith('member-2'))
  })

  it('keeps leader action inputs populated when the action fails', async () => {
    const onInvite = jest.fn().mockResolvedValue(false)
    const onDeclareWar = jest.fn().mockResolvedValue(false)
    const onDeclarePeace = jest.fn().mockResolvedValue(false)
    const myCoalition: CoalitionDetail = {
      id: 'coalition-1',
      name: 'Jantar',
      leader_id: 'me',
      leader_display_name: 'Já',
      created_at: '2026-08-21T10:00:00.000Z',
      members: [
        {
          player_id: 'me',
          display_name: 'Já',
          joined_at: '2026-08-21T10:00:00.000Z',
          is_leader: true,
          is_online: true,
        },
      ],
    }

    render(
      <CoalitionPanel
        myCoalition={myCoalition}
        coalitions={[]}
        invites={[]}
        joinRequests={[]}
        currentPlayerId="me"
        onCreate={noop}
        onRequestJoin={noop}
        onAcceptInvite={noop}
        onRejectInvite={noop}
        onInvite={onInvite}
        onAcceptJoinRequest={noop}
        onRejectJoinRequest={noop}
        onKickMember={noop}
        onTransferLeadership={noop}
        onLeave={noop}
        onDisband={noop}
        onDeclareWar={onDeclareWar}
        onDeclarePeace={onDeclarePeace}
      />
    )

    const inviteInput = screen.getByPlaceholderText('ID hráče') as HTMLInputElement
    fireEvent.change(inviteInput, { target: { value: 'candidate-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Odeslat pozvánku' }))
    await waitFor(() => expect(onInvite).toHaveBeenCalledWith('coalition-1', 'candidate-2'))
    expect(inviteInput.value).toBe('candidate-2')

    const targetInputs = screen.getAllByPlaceholderText('ID cílového hráče') as HTMLInputElement[]
    fireEvent.change(targetInputs[0], { target: { value: 'enemy-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vyhlásit válku' }))
    await waitFor(() => expect(onDeclareWar).toHaveBeenCalledWith('enemy-1'))
    expect(targetInputs[0].value).toBe('enemy-1')

    fireEvent.change(targetInputs[1], { target: { value: 'enemy-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Navrhnout mír' }))
    await waitFor(() => expect(onDeclarePeace).toHaveBeenCalledWith('enemy-2'))
    expect(targetInputs[1].value).toBe('enemy-2')
  })
})
