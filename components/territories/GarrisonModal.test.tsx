import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import GarrisonModal from './GarrisonModal'
import { Territory } from '@/lib/territories/api'

const baseTerritory: Territory = {
  id: 81,
  x: 1,
  y: 79,
  difficulty: 1,
  castle_rank: null,
  village_rank: null,
  owner_id: 'other-player',
  is_home: false,
  claim_locked_by: null,
  claim_started_at: null,
  claim_transfer_arrives_at: null,
  claim_occupation_completes_at: null,
  battle_locked_by: null,
  name: null,
}

const stationedUnit = {
  instance_id: 'unit-1',
  template_id: 'tmpl-archers',
  owner_id: 'other-player',
  stationed_territory_id: 81,
  status: 'stationed' as const,
  card_templates: {
    id: 'tmpl-archers',
    name: 'Pohraniční lučištníci',
    flavor_text: 'Střeží hranice království.',
    rank: 'common',
    category: 'unit' as const,
    unit_type: 'archers',
    base_stats: { str: 5, lng: 14, def: 4, hp: 9 },
    total_supply: null,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
  },
}

describe('GarrisonModal', () => {
  it('shows the other player owner info when provided', () => {
    render(
      <GarrisonModal
        territory={baseTerritory}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        ownerInfo={{
          id: 'other-player',
          display_name: 'Sir Testalot',
          nation: 'england',
          kingdom_name: 'Bílý lev',
          xp: 1250,
          level: 5,
        }}
      />
    )

    expect(screen.getByText(/Jméno:\s*Sir Testalot/)).toBeInTheDocument()
    expect(screen.getByText(/Národ:\s*Anglické království/)).toBeInTheDocument()
    expect(screen.getByText(/Království:\s*Bílý lev/)).toBeInTheDocument()
    expect(screen.getByText(/Úroveň:\s*5/)).toBeInTheDocument()
  })

  it('shows an owner-info loading message while public owner data is being fetched', () => {
    render(
      <GarrisonModal
        territory={baseTerritory}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        ownerInfoLoading
      />
    )

    expect(screen.getByText('Načítám informace o vlastníkovi…')).toBeInTheDocument()
  })

  it('shows an owner-info error message when public owner data fails to load', () => {
    render(
      <GarrisonModal
        territory={baseTerritory}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        ownerInfoError="boom"
      />
    )

    expect(screen.getByText('Nepodařilo se načíst informace o vlastníkovi.')).toBeInTheDocument()
  })

  it("shows the transfer button for the viewer's own territory and wires it correctly", () => {
    const onTransfer = jest.fn()
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        onTransfer={onTransfer}
      />
    )

    const button = screen.getByRole('button', { name: /Přesunout vojska/ })
    expect(screen.queryByRole('button', { name: /Zaútočit/ })).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(onTransfer).toHaveBeenCalled()
  })

  it('shows a generic "in battle" message when no ETA is known', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, battle_locked_by: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
      />
    )

    expect(screen.getByText('Toto území je právě v boji')).toBeInTheDocument()
  })

  it('shows the incoming-attack ETA instead of the generic message when known', () => {
    const arrivesAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, battle_locked_by: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        incomingAttackArrivesAt={arrivesAt}
      />
    )

    expect(screen.getByText(/Útok na cestě — vojska dorazí/)).toBeInTheDocument()
    expect(screen.queryByText('Toto území je právě v boji')).not.toBeInTheDocument()
  })

  it('shows the claim-in-progress ETA when a claim is underway', () => {
    const completesAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
    render(
      <GarrisonModal
        territory={{
          ...baseTerritory,
          owner_id: null,
          claim_locked_by: 'me',
          claim_occupation_completes_at: completesAt,
        }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
      />
    )

    expect(screen.getByText(/Probíhá zábor tohoto území — dokončí se/)).toBeInTheDocument()
  })

  it('displays the territory name prominently when set', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, name: 'Hrad Orlík' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
      />
    )

    expect(screen.getByTestId('territory-name')).toHaveTextContent('Hrad Orlík')
  })

  it('does not show a name element when name is null', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, name: null }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
      />
    )

    expect(screen.queryByTestId('territory-name')).not.toBeInTheDocument()
  })

  it('shows the rename button for the owner and reveals the form on click', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
      />
    )

    expect(screen.queryByTestId('rename-form')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Přejmenovat území' }))
    expect(screen.getByTestId('rename-form')).toBeInTheDocument()
  })

  it('does not show the rename button for a non-owner', () => {
    render(
      <GarrisonModal
        territory={baseTerritory}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
      />
    )

    expect(screen.queryByRole('button', { name: 'Přejmenovat území' })).not.toBeInTheDocument()
  })

  it('calls onRename with the territory id and new name when save is clicked', async () => {
    const onRename = jest.fn().mockResolvedValue(undefined)
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', id: 42 }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={onRename}
        myPlayerId="me"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Přejmenovat území' }))
    fireEvent.change(screen.getByLabelText('Nové jméno území'), { target: { value: 'Hrad Blaník' } })
    fireEvent.click(screen.getByRole('button', { name: 'Uložit' }))

    await waitFor(() => expect(onRename).toHaveBeenCalledWith(42, 'Hrad Blaník'))
    // form collapses after save
    await waitFor(() => expect(screen.queryByTestId('rename-form')).not.toBeInTheDocument())
  })

  it('hides the rename form when cancel is clicked', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Přejmenovat území' }))
    expect(screen.getByTestId('rename-form')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }))
    expect(screen.queryByTestId('rename-form')).not.toBeInTheDocument()
  })

  // --- build structure feature ---

  const castleCard = {
    instance_id: 'ci-castle-1',
    template_id: 'castle-common',
    owner_id: 'me',
    stationed_territory_id: null as number | null,
    status: 'stationed' as const,
    card_templates: {
      id: 'castle-common',
      name: 'Hrad (common)',
      flavor_text: 'x',
      rank: 'common',
      category: 'castle' as const,
      unit_type: null,
      base_stats: null,
      total_supply: 45,
      defense_bonus_pct: 20,
      attack_bonus_pct: 10,
    },
  }

  const villageCard = {
    instance_id: 'ci-village-1',
    template_id: 'village-common',
    owner_id: 'me',
    stationed_territory_id: null as number | null,
    status: 'stationed' as const,
    card_templates: {
      id: 'village-common',
      name: 'Vesnice (common)',
      flavor_text: 'x',
      rank: 'common',
      category: 'village' as const,
      unit_type: null,
      base_stats: null,
      total_supply: 45,
      defense_bonus_pct: 10,
      attack_bonus_pct: null,
    },
  }

  it('does not show the build section for a non-owner', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'other-player' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        structureCardOptions={[castleCard, villageCard]}
      />
    )
    expect(screen.queryByTestId('build-structure-section')).not.toBeInTheDocument()
  })

  it('does not show the build section when the territory already has both structures', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', castle_rank: 'common', village_rank: 'common' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        structureCardOptions={[castleCard, villageCard]}
      />
    )
    expect(screen.queryByTestId('build-structure-section')).not.toBeInTheDocument()
  })

  it('shows castle build row when castle is missing', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        structureCardOptions={[castleCard]}
      />
    )
    expect(screen.getByTestId('build-castle-row')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Hrad' })).toBeInTheDocument()
  })

  it('shows village build row when village is missing', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        structureCardOptions={[villageCard]}
      />
    )
    expect(screen.getByTestId('build-village-row')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Vesnice' })).toBeInTheDocument()
  })

  it('shows disabled hint when player has no castle card and castle is missing', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        structureCardOptions={[]}
      />
    )
    expect(screen.getByTestId('no-castle-cards')).toBeInTheDocument()
    expect(screen.getByTestId('no-village-cards')).toBeInTheDocument()
  })

  it('calls onBuildStructure with correct args when castle is built', async () => {
    const onBuildStructure = jest.fn().mockResolvedValue(undefined)
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', id: 99 }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        structureCardOptions={[castleCard]}
        onBuildStructure={onBuildStructure}
      />
    )

    fireEvent.change(screen.getByRole('combobox', { name: /Vyber kartu hradu/ }), {
      target: { value: 'ci-castle-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Postavit' }))

    await waitFor(() =>
      expect(onBuildStructure).toHaveBeenCalledWith(99, 'ci-castle-1')
    )
  })

  it('hides the castle build row when territory already has a castle', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', castle_rank: 'common' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        structureCardOptions={[castleCard, villageCard]}
      />
    )
    expect(screen.queryByTestId('build-castle-row')).not.toBeInTheDocument()
    // village row still shows
    expect(screen.getByTestId('build-village-row')).toBeInTheDocument()
  })

  it('opens and closes the card zoom modal when a garrison card is clicked', () => {
    render(
      <GarrisonModal
        territory={baseTerritory}
        instances={[stationedUnit]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Zvětšit kartu Pohraniční lučištníci' }))

    expect(screen.getByTestId('card-zoom-modal')).toBeInTheDocument()
    expect(screen.getAllByText('Pohraniční lučištníci')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Zavřít detail karty' }))
    expect(screen.queryByTestId('card-zoom-modal')).not.toBeInTheDocument()
  })
})
