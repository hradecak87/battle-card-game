import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MovementDetailModal from './MovementDetailModal'
import type { MapMovementArrow } from './MapMovementArrows'

const getMovementCards = jest.fn()
const getScoutMovementReport = jest.fn()
const getMyCardInstances = jest.fn()
const sendScoutPeek = jest.fn()
const getMyMovements = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getMovementCards: (...args: unknown[]) => getMovementCards(...args),
  getScoutMovementReport: (...args: unknown[]) => getScoutMovementReport(...args),
  getMyCardInstances: (...args: unknown[]) => getMyCardInstances(...args),
  sendScoutPeek: (...args: unknown[]) => sendScoutPeek(...args),
  getMyMovements: (...args: unknown[]) => getMyMovements(...args),
}))

describe('MovementDetailModal', () => {
  beforeEach(() => {
    getMovementCards.mockReset()
    getMovementCards.mockResolvedValue({ data: [], error: null })
    getScoutMovementReport.mockReset()
    getScoutMovementReport.mockResolvedValue({ data: null, error: null })
    getMyCardInstances.mockReset()
    getMyCardInstances.mockResolvedValue({ data: [], error: null })
    sendScoutPeek.mockReset()
    sendScoutPeek.mockResolvedValue({ data: 'peek-1', error: null })
    getMyMovements.mockReset()
    getMyMovements.mockResolvedValue({ data: [], error: null })
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

  it('shows the ally identity block and loads cards for an allied movement', async () => {
    getMovementCards.mockResolvedValue({
      data: [],
      error: null,
    })

    const arrow: MapMovementArrow = {
      id: 'ally-1',
      category: 'ally-offensive',
      movementId: 'ally-1',
      movementKind: 'attack',
      originTerritoryId: 2,
      destinationTerritoryId: 3,
      originX: 15,
      originY: 16,
      destX: 20,
      destY: 21,
      originName: 'Hrad spojence',
      destinationName: 'Hraniční pevnost',
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      arrivesAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      allyPlayerId: 'ally-player',
      allyDisplayName: 'Spojenec',
      allyKingdomName: 'Severní koruna',
      allyIsNpc: false,
    }

    render(<MovementDetailModal arrow={arrow} onClose={jest.fn()} onNavigateToTerritory={jest.fn()} />)

    expect(await screen.findByText('Spojenec: Spojenec (Severní koruna)')).toBeInTheDocument()
    expect(getMovementCards).toHaveBeenCalledWith('ally-1')
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

  it('shows an incoming scout button and reveals a stored scout snapshot for my incoming attack', async () => {
    getMyCardInstances.mockResolvedValue({
      data: [
        {
          instance_id: 'scout-1',
          template_id: 'scout',
          owner_id: 'me',
          stationed_territory_id: 12,
          status: 'stationed',
          card_templates: {
            id: 'scout',
            name: 'Zvěd',
            flavor_text: '',
            rank: 'uncommon',
            category: 'scout',
            unit_type: null,
            base_stats: { str: 0, lng: 0, def: 0, hp: 0, speed: 30 },
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
          territories: null,
        },
      ],
      error: null,
    })
    getScoutMovementReport.mockResolvedValue({
      data: {
        id: 1,
        scout_player_id: 'me',
        target_territory_id: null,
        target_movement_id: 'incoming-1',
        captured_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        snapshot: [
          {
            template_id: 'tmpl-1',
            category: 'unit',
            unit_type: 'archers',
            rank: 'rare',
            name: 'Královští lučištníci',
            flavor_text: 'Přesná salva.',
            base_stats: { str: 4, lng: 9, def: 3, hp: 6, speed: 5 },
            total_supply: null,
          },
        ],
      },
      error: null,
    })

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

    render(<MovementDetailModal arrow={arrow} onClose={jest.fn()} onNavigateToTerritory={jest.fn()} />)

    expect(await screen.findByRole('button', { name: /Vyslat zvěda \(1 ks\)/ })).toBeInTheDocument()
    expect(await screen.findByText('Královští lučištníci')).toBeInTheDocument()
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
