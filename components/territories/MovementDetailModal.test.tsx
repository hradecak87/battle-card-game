import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MovementDetailModal from './MovementDetailModal'
import type { MapMovementArrow } from './MapMovementArrows'

const getMovementCards = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getMovementCards: (...args: unknown[]) => getMovementCards(...args),
}))

describe('MovementDetailModal', () => {
  beforeEach(() => {
    getMovementCards.mockReset()
    getMovementCards.mockResolvedValue({ data: [], error: null })
  })

  it('loads and renders full card composition for my own movement', async () => {
    getMovementCards.mockResolvedValue({
      data: [
        {
          instance_id: 'card-1',
          template_id: 'tmpl-1',
          owner_id: 'me',
          stationed_territory_id: null,
          status: 'in_transit',
          card_templates: {
            id: 'tmpl-1',
            name: 'Královští lučištníci',
            flavor_text: 'Přesná salva.',
            rank: 'rare',
            category: 'unit',
            unit_type: 'archers',
            base_stats: { str: 4, lng: 9, def: 3, hp: 6, speed: 5 },
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
        },
      ],
      error: null,
    })

    const arrow: MapMovementArrow = {
      id: 'mine-1',
      category: 'offensive',
      movementId: 'mine-1',
      movementKind: 'attack',
      originTerritoryId: 1,
      destinationTerritoryId: 2,
      originX: 10,
      originY: 11,
      destX: 12,
      destY: 13,
      originName: 'Hrad',
      destinationName: 'Cíl',
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      arrivesAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    }
    const onNavigateToTerritory = jest.fn()

    render(
      <MovementDetailModal
        arrow={arrow}
        onClose={jest.fn()}
        onNavigateToTerritory={onNavigateToTerritory}
      />
    )

    expect(await screen.findByText('Královští lučištníci')).toBeInTheDocument()
    expect(getMovementCards).toHaveBeenCalledWith('mine-1')

    await userEvent.click(screen.getByRole('button', { name: /Hrad/ }))
    expect(onNavigateToTerritory).toHaveBeenCalledWith(10, 11)
  })

  it('keeps incoming attacks under fog of war and does not fetch movement cards', async () => {
    const arrow: MapMovementArrow = {
      id: 'incoming-1',
      category: 'incoming',
      originX: 20,
      originY: 21,
      destX: 12,
      destY: 13,
      destinationName: 'Moje hranice',
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      arrivesAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      attackerId: 'enemy-1',
      attackerDisplayName: 'Nepřítel',
      attackerKingdomName: 'Temný hvozd',
      attackerIsNpc: false,
      attackerHomeX: 20,
      attackerHomeY: 21,
    }

    render(
      <MovementDetailModal
        arrow={arrow}
        onClose={jest.fn()}
        onNavigateToTerritory={jest.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Složení útočící armády zůstává skryté/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Královští lučištníci')).not.toBeInTheDocument()
    expect(getMovementCards).not.toHaveBeenCalled()
  })
})
