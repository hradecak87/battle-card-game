import { render, screen } from '@testing-library/react'
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
