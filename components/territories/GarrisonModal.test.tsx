import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import GarrisonModal from './GarrisonModal'
import type { CardInstanceWithTemplate, Territory } from '@/lib/territories/api'

const baseTerritory: Territory = {
  id: 81,
  x: 1,
  y: 79,
  difficulty: 1,
  castle_rank: null,
  village_rank: null,
  wall_rank: null,
  owner_id: 'other-player',
  is_home: false,
  claim_locked_by: null,
  claim_started_at: null,
  claim_transfer_arrives_at: null,
  claim_occupation_completes_at: null,
  battle_locked_by: null,
  name: null,
}

const stationedUnit: CardInstanceWithTemplate = {
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
    base_stats: { str: 5, lng: 14, def: 4, hp: 9, speed: 5 },
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

const ownedBoost: CardInstanceWithTemplate = {
  instance_id: 'boost-owned-1',
  template_id: 'boost-owned-template',
  owner_id: 'me',
  stationed_territory_id: 81,
  status: 'stationed' as const,
  card_templates: {
    id: 'boost-owned-template',
    name: 'Pevná hradba',
    flavor_text: 'Štíty se semknou.',
    rank: 'uncommon',
    category: 'boost' as const,
    unit_type: null,
    base_stats: null,
    total_supply: null,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
    boost_type: 'territorial',
    effect_kind: 'stat_multiplier',
    instant_effect_kind: null,
    pct_str: null,
    pct_lng: null,
    pct_def: 12,
    pct_hp: 8,
  },
}

const maskedForeignBoost: CardInstanceWithTemplate = {
  ...ownedBoost,
  instance_id: 'boost-foreign-1',
  owner_id: 'other-player',
  card_templates: {
    ...ownedBoost.card_templates!,
    rank: 'epic',
    name: null,
    flavor_text: null,
    boost_type: null,
    effect_kind: null,
    instant_effect_kind: null,
    pct_str: null,
    pct_lng: null,
    pct_def: null,
    pct_hp: null,
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

  it('labels NPC owners explicitly in the owner info panel', () => {
    render(
      <GarrisonModal
        territory={baseTerritory}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        ownerInfo={{
          id: 'npc-player',
          display_name: 'NPC Francia',
          nation: 'francia',
          kingdom_name: 'Franské marky',
          xp: 900,
          level: 4,
          is_npc: true,
        }}
      />
    )

    expect(screen.getByText('Typ: NPC říše')).toBeInTheDocument()
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

  it('shows the incoming-attack info instead of the generic message when known', () => {
    const arrivesAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const onNavigateToTerritory = jest.fn()
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, battle_locked_by: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        incomingAttackInfo={{
          transfer_arrives_at: arrivesAt,
          attacker_id: 'attacker-1',
          attacker_display_name: 'Útočník Karel',
          attacker_kingdom_name: null,
          attacker_is_npc: false,
          attacker_home_x: 10,
          attacker_home_y: 20,
        }}
        onNavigateToTerritory={onNavigateToTerritory}
      />
    )

    expect(screen.getByText(/Útok od/)).toBeInTheDocument()
    expect(screen.queryByText('Toto území je právě v boji')).not.toBeInTheDocument()
    const attackerLink = screen.getByRole('button', { name: 'Útočník Karel' })
    fireEvent.click(attackerLink)
    expect(onNavigateToTerritory).toHaveBeenCalledWith(10, 20)
  })

  it('shows a war badge for foreign owners currently at war with the viewer', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'enemy-1' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        ownerInfo={{
          id: 'enemy-1',
          display_name: 'Nepřítel',
          nation: 'england',
          kingdom_name: 'Nepřátelé',
          xp: 1000,
          level: 5,
        }}
        relationState="war"
      />
    )

    expect(screen.getByTestId('garrison-war-badge')).toHaveAttribute('href', '/diplomacy')
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

    expect(screen.getByText(/Probíhá zábor tohoto území/)).toBeInTheDocument()
    expect(screen.getByText(/neznámý hráč/)).toBeInTheDocument()
    expect(screen.getByText(/dokončí se/)).toBeInTheDocument()
  })

  it('shows the claimant name and a link to their home when claimInfo is available', () => {
    const completesAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
    const onNavigateToTerritory = jest.fn()
    render(
      <GarrisonModal
        territory={{
          ...baseTerritory,
          owner_id: null,
          claim_locked_by: 'attacker-1',
          claim_occupation_completes_at: completesAt,
        }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        claimInfo={{
          claimant_id: 'attacker-1',
          claimant_display_name: 'Attacker Name',
          claimant_kingdom_name: 'Attackerland',
          claimant_is_npc: false,
          claimant_home_x: 12,
          claimant_home_y: 34,
        }}
        onNavigateToTerritory={onNavigateToTerritory}
      />
    )

    expect(screen.getByText(/Attacker Name/)).toBeInTheDocument()
    const homeButton = screen.getByRole('button', { name: 'Attacker Name' })
    fireEvent.click(homeButton)
    expect(onNavigateToTerritory).toHaveBeenCalledWith(12, 34)
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

  it('shows owned boost cards with their full details', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me' }}
        instances={[ownedBoost]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
      />
    )

    expect(screen.getByText('Pevná hradba')).toBeInTheDocument()
    expect(screen.getByText(/Obrana \+12 % · HP \+8 %/)).toBeInTheDocument()
  })

  it('masks foreign boost cards down to rarity and count only', () => {
    render(
      <GarrisonModal
        territory={baseTerritory}
        instances={[maskedForeignBoost, { ...maskedForeignBoost, instance_id: 'boost-foreign-2' }]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
      />
    )

    expect(screen.getByTestId('foreign-boost-summary')).toHaveTextContent('Epic ×2')
    expect(screen.queryByText('Pevná hradba')).not.toBeInTheDocument()
    expect(screen.queryByText(/Štíty se semknou/)).not.toBeInTheDocument()
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

  const wallCard = {
    instance_id: 'ci-wall-1',
    template_id: 'wall-common',
    owner_id: 'me',
    stationed_territory_id: null as number | null,
    status: 'stationed' as const,
    card_templates: {
      id: 'wall-common',
      name: 'Hradby (common)',
      flavor_text: 'x',
      rank: 'common',
      category: 'wall' as const,
      unit_type: null,
      base_stats: null,
      total_supply: 45,
      defense_bonus_pct: 5,
      attack_bonus_pct: 5,
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

  it('shows wall build row when no structure is present', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        structureCardOptions={[castleCard, villageCard, wallCard]}
      />
    )
    expect(screen.getByTestId('build-wall-row')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Hradby' })).toBeInTheDocument()
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
    expect(screen.queryByTestId('build-wall-row')).not.toBeInTheDocument()
  })

  it('shows the wall rank and hides castle/village build rows when walls are already built', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', wall_rank: 'rare' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        structureCardOptions={[castleCard, villageCard, wallCard]}
      />
    )
    expect(screen.getByText('Hradby: rare')).toBeInTheDocument()
    expect(screen.queryByTestId('build-castle-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('build-village-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('build-wall-row')).not.toBeInTheDocument()
  })

  // --- abandon territory feature (#19) ---

  it('shows the abandon button for the owner of a non-home territory', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', is_home: false }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        onAbandon={jest.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Vzdát se území' })).toBeInTheDocument()
  })

  it('does not show the abandon button for the home territory', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', is_home: true }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        onAbandon={jest.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Vzdát se území' })).not.toBeInTheDocument()
  })

  it('does not show the abandon button for a non-owner', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'other-player', is_home: false }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        onAbandon={jest.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Vzdát se území' })).not.toBeInTheDocument()
  })

  it('does not show the abandon button when onAbandon is not provided', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', is_home: false }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
      />
    )
    expect(screen.queryByRole('button', { name: 'Vzdát se území' })).not.toBeInTheDocument()
  })

  it('shows the king relocation button only for an eligible owner on a non-home territory', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', is_home: false }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        kingRelocationAvailable
        onRelocateHome={jest.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Přesunout sem domovské území' })).toBeInTheDocument()
  })

  it('does not show the king relocation button when the ability is unavailable', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', is_home: false }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        kingRelocationAvailable={false}
        onRelocateHome={jest.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Přesunout sem domovské území' })).not.toBeInTheDocument()
  })

  it('shows a confirm step and calls onRelocateHome with the territory id', async () => {
    const onRelocateHome = jest.fn().mockResolvedValue(undefined)
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', is_home: false, id: 456 }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        kingRelocationAvailable
        onRelocateHome={onRelocateHome}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Přesunout sem domovské území' }))
    expect(screen.getByTestId('relocate-home-confirm')).toBeInTheDocument()
    expect(screen.getByText(/použít jen jednou za celou hru/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ano, přesunout domovské území' }))
    await waitFor(() => expect(onRelocateHome).toHaveBeenCalledWith(456))
  })

  it('shows an error message when onRelocateHome rejects', async () => {
    const onRelocateHome = jest.fn().mockRejectedValue(new Error('king ability has already been used'))
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', is_home: false }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        kingRelocationAvailable
        onRelocateHome={onRelocateHome}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Přesunout sem domovské území' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ano, přesunout domovské území' }))

    await waitFor(() =>
      expect(screen.getByText('king ability has already been used')).toBeInTheDocument()
    )
  })

  it('shows a warning confirm step and calls onAbandon with the territory id when confirmed', async () => {
    const onAbandon = jest.fn().mockResolvedValue(undefined)
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', is_home: false, id: 123 }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        onAbandon={onAbandon}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Vzdát se území' }))
    expect(screen.getByTestId('abandon-confirm')).toBeInTheDocument()
    expect(screen.getByText(/vydají na cestu zpět do tvého domovského území/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ano, vzdát se území' }))
    await waitFor(() => expect(onAbandon).toHaveBeenCalledWith(123))
  })

  it('hides the abandon confirm step when cancel is clicked', () => {
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', is_home: false }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        onAbandon={jest.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Vzdát se území' }))
    expect(screen.getByTestId('abandon-confirm')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }))
    expect(screen.queryByTestId('abandon-confirm')).not.toBeInTheDocument()
  })

  it('shows an error message when onAbandon rejects', async () => {
    const onAbandon = jest.fn().mockRejectedValue(new Error('cannot abandon a territory with an unresolved battle'))
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me', is_home: false }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
        onRename={jest.fn()}
        myPlayerId="me"
        onAbandon={onAbandon}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Vzdát se území' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ano, vzdát se území' }))

    await waitFor(() =>
      expect(screen.getByText('cannot abandon a territory with an unresolved battle')).toBeInTheDocument()
    )
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
