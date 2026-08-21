import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

    // Regression: cards used to render as a plain text list; they should
    // now show up as real card thumbnails (matching TransferModal/
    // GarrisonModal) laid out in a responsive multi-column grid, each with
    // its own magnifier button to open the full zoomed-in card.
    expect(screen.getByRole('button', { name: 'Zvětšit kartu Královští lučištníci' })).toBeInTheDocument()

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

  it('stays clickable when rendered inside a pointer-events-none ancestor (map overlay regression)', async () => {
    // MovementDetailModal is rendered as a sibling inside MapMovementArrows'
    // output, which itself sits inside a pointer-events-none wrapper in
    // MapViewport (so the arrows overlay doesn't swallow tile hover/click).
    // Without an explicit pointer-events-auto override, the modal (and its
    // close button/backdrop) would inherit pointer-events: none and become
    // visually present but completely unclickable.
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

    const onClose = jest.fn()
    const { container } = render(
      <div className="pointer-events-none">
        <MovementDetailModal arrow={arrow} onClose={onClose} onNavigateToTerritory={jest.fn()} />
      </div>
    )

    const backdrop = container.querySelector('.fixed.inset-0.z-50')
    expect(backdrop).toHaveClass('pointer-events-auto')

    fireEvent.click(screen.getByRole('button', { name: 'Zavřít detail pohybu' }))
    expect(onClose).toHaveBeenCalled()
  })
})
