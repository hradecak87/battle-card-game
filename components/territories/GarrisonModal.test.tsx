import { fireEvent, render, screen } from '@testing-library/react'
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
}

describe('GarrisonModal', () => {
  it('shows the other player owner info when provided', () => {
    render(
      <GarrisonModal
        territory={baseTerritory}
        instances={[]}
        error={null}
        onClose={jest.fn()}
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
        ownerInfoError="boom"
      />
    )

    expect(screen.getByText('Nepodařilo se načíst informace o vlastníkovi.')).toBeInTheDocument()
  })

  it('shows the transfer button for the viewer’s own territory and wires it correctly', () => {
    const onTransfer = jest.fn()
    render(
      <GarrisonModal
        territory={{ ...baseTerritory, owner_id: 'me' }}
        instances={[]}
        error={null}
        onClose={jest.fn()}
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
      />
    )

    expect(screen.getByText(/Probíhá zábor tohoto území — dokončí se/)).toBeInTheDocument()
  })
})
