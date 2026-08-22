import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LendModal from './LendModal'
import type { Territory } from '@/lib/territories/api'

const getCardInstancesAtTerritory = jest.fn()
const getMyTerritories = jest.fn()
const getPlayerPublicInfo = jest.fn()
const lendTroops = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getCardInstancesAtTerritory: (...args: unknown[]) => getCardInstancesAtTerritory(...args),
  getMyTerritories: (...args: unknown[]) => getMyTerritories(...args),
  getPlayerPublicInfo: (...args: unknown[]) => getPlayerPublicInfo(...args),
  lendTroops: (...args: unknown[]) => lendTroops(...args),
}))

const destinationTerritory: Territory = {
  id: 22,
  x: 7,
  y: 8,
  difficulty: 2,
  castle_rank: null,
  village_rank: null,
  wall_rank: null,
  owner_id: 'ally-1',
  is_home: false,
  claim_locked_by: null,
  claim_started_at: null,
  claim_transfer_arrives_at: null,
  claim_occupation_completes_at: null,
  battle_locked_by: null,
  name: 'Hraniční pevnost',
}

const unitCard = {
  instance_id: 'unit-1',
  template_id: 'tmpl-1',
  owner_id: 'me',
  stationed_territory_id: 10,
  status: 'stationed' as const,
  loaned_from_id: null,
  loan_return_at: null,
  loaned_from_display_name: null,
  card_templates: {
    id: 'tmpl-1',
    name: 'Elitní rytíři',
    flavor_text: 'Silná jízda.',
    rank: 'rare',
    category: 'unit' as const,
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

const borrowedCard = {
  ...unitCard,
  instance_id: 'borrowed-1',
  loaned_from_id: 'other-ally',
  loaned_from_display_name: 'Jiný spojenec',
}

describe('LendModal', () => {
  beforeEach(() => {
    getCardInstancesAtTerritory.mockReset()
    getMyTerritories.mockReset()
    getPlayerPublicInfo.mockReset()
    lendTroops.mockReset()

    getPlayerPublicInfo.mockResolvedValue({
      data: { id: 'me', display_name: 'Já', nation: 'england', kingdom_name: null, xp: 0 },
      error: null,
    })
    getMyTerritories.mockResolvedValue({
      data: [
        { id: 1, x: 0, y: 0, is_home: true },
        { id: 10, x: 4, y: 4, is_home: false },
      ],
      error: null,
    })
  })

  it('lists my own territories as origins, filters out already-borrowed cards, and calls lendTroops', async () => {
    const onLent = jest.fn()
    getCardInstancesAtTerritory.mockResolvedValue({ data: [unitCard, borrowedCard], error: null })
    lendTroops.mockResolvedValue({ data: null, error: null })

    render(
      <LendModal
        destinationTerritory={destinationTerritory}
        myPlayerId="me"
        onClose={jest.fn()}
        onLent={onLent}
      />,
    )

    const originSelect = (await screen.findByLabelText('Odkud posíláš')) as HTMLSelectElement
    await waitFor(() => expect(getMyTerritories).toHaveBeenCalledWith('me'))
    const options = Array.from(originSelect.options).map((o) => o.textContent)
    expect(options).toEqual(['— vyber území —', 'Domov (0, 0)', 'Území (4, 4)'])

    fireEvent.change(originSelect, { target: { value: '10' } })

    await waitFor(() => expect(getCardInstancesAtTerritory).toHaveBeenCalledWith(10))
    expect(await screen.findByText('Elitní rytíři')).toBeInTheDocument()
    expect(screen.queryByTestId('lend-card-select-borrowed-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('lend-card-select-unit-1'))
    fireEvent.change(screen.getByLabelText('Doba půjčky (hodiny)'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /Půjčit vojska/ }))

    await waitFor(() => expect(lendTroops).toHaveBeenCalledWith(22, ['unit-1'], 12))
    expect(onLent).toHaveBeenCalled()
  })

  it('shows an ETA once an origin territory is picked', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [unitCard], error: null })

    render(<LendModal destinationTerritory={destinationTerritory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.change(await screen.findByLabelText('Odkud posíláš'), { target: { value: '10' } })

    expect(await screen.findByText(/Vojska dorazí na cíl:/)).toBeInTheDocument()
  })

  it('shows an inline RPC error', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [unitCard], error: null })
    lendTroops.mockResolvedValue({ data: null, error: { message: 'Nelze půjčit vojska.' } })

    render(<LendModal destinationTerritory={destinationTerritory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.change(await screen.findByLabelText('Odkud posíláš'), { target: { value: '10' } })
    await screen.findByText('Elitní rytíři')
    fireEvent.click(screen.getByTestId('lend-card-select-unit-1'))
    fireEvent.click(screen.getByRole('button', { name: /Půjčit vojska/ }))

    expect(await screen.findByText('Nelze půjčit vojska.')).toBeInTheDocument()
  })

  it('keeps padding and stable scrollbar gutter around the lending card grid', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [unitCard], error: null })

    render(<LendModal destinationTerritory={destinationTerritory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.change(await screen.findByLabelText('Odkud posíláš'), { target: { value: '10' } })
    const card = await screen.findByTestId('lend-card-select-unit-1')
    const grid = card.closest('div.grid')

    expect(grid).not.toBeNull()
    expect(grid).toHaveClass('p-2', '[scrollbar-gutter:stable]')
  })
})
