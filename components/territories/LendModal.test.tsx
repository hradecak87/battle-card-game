import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LendModal from './LendModal'
import type { CardInstanceWithTemplate, Territory } from '@/lib/territories/api'

const getMyCoalition = jest.fn()
const getMyTerritories = jest.fn()
const getPlayerPublicInfo = jest.fn()
const lendTroops = jest.fn()

jest.mock('@/lib/diplomacy/api', () => ({
  getMyCoalition: (...args: unknown[]) => getMyCoalition(...args),
}))

jest.mock('@/lib/territories/api', () => ({
  getMyTerritories: (...args: unknown[]) => getMyTerritories(...args),
  getPlayerPublicInfo: (...args: unknown[]) => getPlayerPublicInfo(...args),
  lendTroops: (...args: unknown[]) => lendTroops(...args),
}))

const originTerritory: Territory = {
  id: 10,
  x: 4,
  y: 4,
  difficulty: 2,
  castle_rank: null,
  village_rank: null,
  wall_rank: null,
  owner_id: 'me',
  is_home: false,
  claim_locked_by: null,
  claim_started_at: null,
  claim_transfer_arrives_at: null,
  claim_occupation_completes_at: null,
  battle_locked_by: null,
  name: 'Domácí tvrz',
}

const unitCard: CardInstanceWithTemplate = {
  instance_id: 'unit-1',
  template_id: 'tmpl-1',
  owner_id: 'me',
  stationed_territory_id: 10,
  status: 'stationed',
  loaned_from_id: null,
  loan_return_at: null,
  loaned_from_display_name: null,
  card_templates: {
    id: 'tmpl-1',
    name: 'Elitní rytíři',
    flavor_text: 'Silná jízda.',
    rank: 'rare',
    category: 'unit',
    unit_type: 'knights',
    base_stats: { str: 20, lng: 5, def: 15, hp: 30, speed: 6 },
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

const borrowedCard: CardInstanceWithTemplate = {
  ...unitCard,
  instance_id: 'borrowed-1',
  owner_id: 'me',
  loaned_from_id: 'ally-1',
  loaned_from_display_name: 'Spojenec',
}

describe('LendModal', () => {
  beforeEach(() => {
    getMyCoalition.mockReset()
    getMyTerritories.mockReset()
    getPlayerPublicInfo.mockReset()
    lendTroops.mockReset()

    getPlayerPublicInfo.mockResolvedValue({
      data: { id: 'me', display_name: 'Já', nation: 'england', kingdom_name: null, xp: 0 },
      error: null,
    })
    getMyCoalition.mockResolvedValue({
      data: [
        {
          id: 'coalition-1',
          name: 'Aliance',
          leader_id: 'me',
          leader_display_name: 'Já',
          created_at: new Date().toISOString(),
          members: [
            { player_id: 'me', display_name: 'Já', joined_at: new Date().toISOString(), is_leader: true, is_online: true },
            { player_id: 'ally-1', display_name: 'Spojenec', joined_at: new Date().toISOString(), is_leader: false, is_online: true },
          ],
        },
      ],
      error: null,
    })
    getMyTerritories.mockResolvedValue({
      data: [{ id: 22, x: 7, y: 8, is_home: false, name: 'Hraniční pevnost' }],
      error: null,
    })
  })

  it('lists only coalition destinations, filters out already borrowed cards, and calls lendTroops', async () => {
    const onLent = jest.fn()
    lendTroops.mockResolvedValue({ data: null, error: null })

    render(
      <LendModal
        originTerritory={originTerritory}
        myPlayerId="me"
        instances={[unitCard, borrowedCard]}
        onClose={jest.fn()}
        onLent={onLent}
      />,
    )

    const destinationSelect = await screen.findByLabelText('Kam půjčuješ')
    expect(screen.getByRole('option', { name: /Spojenec — Hraniční pevnost/ })).toBeInTheDocument()

    fireEvent.change(destinationSelect, { target: { value: '22' } })
    fireEvent.click(screen.getByTestId('lend-card-select-unit-1'))
    fireEvent.change(screen.getByLabelText('Doba půjčky (hodiny)'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /Půjčit vojska/ }))

    await waitFor(() => expect(lendTroops).toHaveBeenCalledWith(22, ['unit-1'], 12))
    expect(screen.queryByTestId('lend-card-select-borrowed-1')).not.toBeInTheDocument()
    expect(onLent).toHaveBeenCalled()
  })

  it('shows an inline RPC error', async () => {
    lendTroops.mockResolvedValue({ data: null, error: { message: 'Nelze půjčit vojska.' } })

    render(
      <LendModal originTerritory={originTerritory} myPlayerId="me" instances={[unitCard]} onClose={jest.fn()} />,
    )

    fireEvent.change(await screen.findByLabelText('Kam půjčuješ'), { target: { value: '22' } })
    fireEvent.click(screen.getByTestId('lend-card-select-unit-1'))
    fireEvent.click(screen.getByRole('button', { name: /Půjčit vojska/ }))

    expect(await screen.findByText('Nelze půjčit vojska.')).toBeInTheDocument()
  })
})
