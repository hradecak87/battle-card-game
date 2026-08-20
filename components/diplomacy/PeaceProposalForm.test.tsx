import { fireEvent, render, screen } from '@testing-library/react'
import { PeaceProposalForm } from './PeaceProposalForm'

const unitCard = {
  instance_id: 'unit-1',
  template_id: 'archers-common-01',
  owner_id: 'me',
  stationed_territory_id: 1,
  status: 'stationed' as const,
  territories: { id: 1, x: 1, y: 1, is_home: true },
  card_templates: {
    id: 'archers-common-01',
    name: 'Práčata',
    flavor_text: 'Text',
    rank: 'common' as const,
    category: 'unit' as const,
    unit_type: 'archers' as const,
    base_stats: { str: 1, lng: 8, def: 2, hp: 4, speed: 6 },
    total_supply: null,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
    boost_type: null,
    effect_kind: null,
    instant_effect_kind: null,
    pct_str: null,
    pct_lng: null,
    pct_def: null,
    pct_hp: null,
  },
}

const boostCard = {
  ...unitCard,
  instance_id: 'boost-1',
  template_id: 'boost-common-01',
  stationed_territory_id: null,
  card_templates: {
    ...unitCard.card_templates,
    id: 'boost-common-01',
    name: 'Krysa',
    category: 'boost' as const,
    unit_type: null,
    base_stats: null,
    boost_type: 'offensive' as const,
    effect_kind: 'instant_effect' as const,
    instant_effect_kind: 'steal_unit' as const,
  },
}

describe('PeaceProposalForm', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <PeaceProposalForm
        isOpen={false}
        targetPlayerId="player-2"
        targetPlayerName="Karel"
        availableCards={[]}
        availableTerritories={[]}
        onClose={jest.fn()}
        onSubmit={jest.fn().mockResolvedValue({ ok: true })}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('submits white peace with empty tribute and uses fullscreen mobile overlay classes', async () => {
    const onSubmit = jest.fn().mockResolvedValue({ ok: true })

    render(
      <PeaceProposalForm
        isOpen
        targetPlayerId="player-2"
        targetPlayerName="Karel"
        availableCards={[unitCard]}
        availableTerritories={[]}
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByTestId('peace-proposal-overlay')).toHaveClass('fixed', 'inset-0', 'md:justify-center')

    fireEvent.click(screen.getByRole('button', { name: 'Odeslat návrh' }))

    expect(onSubmit).toHaveBeenCalledWith({
      targetPlayerId: 'player-2',
      kind: 'white_peace',
      offeredCardIds: [],
      offeredTerritoryId: null,
    })
  })

  it('submits tribute peace with selected cards and territory', async () => {
    const onSubmit = jest.fn().mockResolvedValue({ ok: true })

    render(
      <PeaceProposalForm
        isOpen
        targetPlayerId="player-2"
        targetPlayerName="Karel"
        availableCards={[unitCard, boostCard]}
        availableTerritories={[
          { id: 9, x: 9, y: 10, is_home: false, castle_rank: null, village_rank: null, wall_rank: null, name: 'Pohraničí', battle_locked_by: null },
        ]}
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mír za tribut' }))
    fireEvent.click(screen.getAllByRole('button').find((button) => button.className.includes('ring-1'))!)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Odeslat návrh' }))

    expect(onSubmit).toHaveBeenCalledWith({
      targetPlayerId: 'player-2',
      kind: 'tribute_peace',
      offeredCardIds: ['unit-1'],
      offeredTerritoryId: 9,
    })
  })

  it('filters out home, locked, and garrisoned territories from the tribute picker', () => {
    render(
      <PeaceProposalForm
        isOpen
        targetPlayerId="player-2"
        targetPlayerName="Karel"
        availableCards={[unitCard]}
        availableTerritories={[
          { id: 1, x: 1, y: 1, is_home: true, castle_rank: null, village_rank: null, wall_rank: null, name: 'Domov', battle_locked_by: null },
          { id: 2, x: 2, y: 2, is_home: false, castle_rank: null, village_rank: null, wall_rank: null, name: 'Nárok', claim_locked_by: 'claim-1', battle_locked_by: null },
          { id: 3, x: 3, y: 3, is_home: false, castle_rank: null, village_rank: null, wall_rank: null, name: 'Bitva', battle_locked_by: 'battle-1' },
          { id: 9, x: 9, y: 10, is_home: false, castle_rank: null, village_rank: null, wall_rank: null, name: 'Volné pohraničí', battle_locked_by: null },
        ]}
        onClose={jest.fn()}
        onSubmit={jest.fn().mockResolvedValue({ ok: true })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mír za tribut' }))

    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['Žádné území', 'Volné pohraničí (9, 10)'])
  })
})
