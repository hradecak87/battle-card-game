import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TerritoryDetailPanel, { CardInstanceOption } from './TerritoryDetailPanel'
import { Territory } from '@/lib/territories/api'
import { UnitCardTemplate, StructureCardTemplate } from '@/lib/cards/types'

const baseTerritory: Territory = {
  id: 42,
  x: 10,
  y: 10,
  difficulty: 2,
  castle_rank: null,
  village_rank: null,
  owner_id: null,
  is_home: false,
  claim_locked_by: null,
  battle_locked_by: null,
  claim_started_at: null,
  claim_transfer_arrives_at: null,
  claim_occupation_completes_at: null,
}

const unitTemplate: UnitCardTemplate = {
  id: 'archers-common-01',
  category: 'unit',
  unitType: 'archers',
  rank: 'common',
  name: 'Práčata',
  flavorText: 'flavor',
  baseStats: { str: 1, lng: 8, def: 2, hp: 4 },
  totalSupply: null,
}

const castleTemplate: StructureCardTemplate = {
  id: 'castle-rare',
  category: 'castle',
  rank: 'rare',
  name: 'Hrad (rare)',
  flavorText: 'flavor',
  defenseBonusPct: 55,
  attackBonusPct: 35,
  totalSupply: 10,
}

const unitOption: CardInstanceOption = { instanceId: 'inst-1', template: unitTemplate }
const castleOption: CardInstanceOption = { instanceId: 'inst-2', template: castleTemplate }

function noop() {
  return Promise.resolve()
}

describe('TerritoryDetailPanel', () => {
  it('shows the claim action for an empty/lockable tile', () => {
    render(
      <TerritoryDetailPanel
        territory={baseTerritory}
        myPlayerId="me"
        originInstances={[unitOption]}
        onClaim={noop}
        onTransfer={noop}
        onCancelClaim={noop}
        onBuildStructure={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Zabrat území' })).toBeInTheDocument()
    expect(screen.getByText('Práčata')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Poslat vojska' })).not.toBeInTheDocument()
  })

  it('shows cancel-claim for a tile the caller is currently claiming', () => {
    render(
      <TerritoryDetailPanel
        territory={{ ...baseTerritory, claim_locked_by: 'me' }}
        myPlayerId="me"
        originInstances={[]}
        onClaim={noop}
        onTransfer={noop}
        onCancelClaim={noop}
        onBuildStructure={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Zrušit zábor' })).toBeInTheDocument()
  })

  it('shows no actions for a tile someone else is claiming', () => {
    render(
      <TerritoryDetailPanel
        territory={{ ...baseTerritory, claim_locked_by: 'other' }}
        myPlayerId="me"
        originInstances={[]}
        onClaim={noop}
        onTransfer={noop}
        onCancelClaim={noop}
        onBuildStructure={noop}
      />
    )
    expect(screen.getByText(/právě zabírá jiný hráč/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows send-troops and build-structure actions for a tile the caller owns', () => {
    render(
      <TerritoryDetailPanel
        territory={{ ...baseTerritory, owner_id: 'me' }}
        myPlayerId="me"
        originInstances={[unitOption, castleOption]}
        onClaim={noop}
        onTransfer={noop}
        onCancelClaim={noop}
        onBuildStructure={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Poslat vojska' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Postavit' })).toBeInTheDocument()
    // Structure card must not appear as a troop checkbox, only as a build option.
    expect(screen.queryByRole('checkbox', { name: /Hrad/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Hrad (rare)' })).toBeInTheDocument()
  })

  it('shows no actions for a tile another player owns', () => {
    render(
      <TerritoryDetailPanel
        territory={{ ...baseTerritory, owner_id: 'other' }}
        myPlayerId="me"
        originInstances={[]}
        onClaim={noop}
        onTransfer={noop}
        onCancelClaim={noop}
        onBuildStructure={noop}
      />
    )
    expect(screen.getByText(/vlastní jiný hráč/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the NPC garrison notice for a pre-seeded structure tile', () => {
    render(
      <TerritoryDetailPanel
        territory={{ ...baseTerritory, castle_rank: 'common' }}
        myPlayerId="me"
        originInstances={[]}
        garrisonSize={5}
        onClaim={noop}
        onTransfer={noop}
        onCancelClaim={noop}
        onBuildStructure={noop}
      />
    )
    expect(screen.getByText(/hlídá posádka NPC/)).toBeInTheDocument()
    expect(screen.getByText('Posádka: 5')).toBeInTheDocument()
  })

  it('selecting troops and submitting calls onClaim with the right args', async () => {
    const onClaim = jest.fn().mockResolvedValue(undefined)
    render(
      <TerritoryDetailPanel
        territory={baseTerritory}
        myPlayerId="me"
        originInstances={[unitOption]}
        onClaim={onClaim}
        onTransfer={noop}
        onCancelClaim={noop}
        onBuildStructure={noop}
      />
    )
    fireEvent.change(screen.getByLabelText('Původní území'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Zabrat území' }))

    await waitFor(() => expect(onClaim).toHaveBeenCalledWith(7, ['inst-1']))
  })

  it('renders a rejected RPC call as a visible, user-facing error', async () => {
    const onClaim = jest.fn().mockRejectedValue(new Error('destination territory is not available to claim'))
    render(
      <TerritoryDetailPanel
        territory={baseTerritory}
        myPlayerId="me"
        originInstances={[unitOption]}
        onClaim={onClaim}
        onTransfer={noop}
        onCancelClaim={noop}
        onBuildStructure={noop}
      />
    )
    fireEvent.change(screen.getByLabelText('Původní území'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Zabrat území' }))

    await waitFor(() =>
      expect(screen.getByText('destination territory is not available to claim')).toBeInTheDocument()
    )
  })
})
