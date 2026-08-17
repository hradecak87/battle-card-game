import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TransferModal from './TransferModal'
import { Territory } from '@/lib/territories/api'

const getCardInstancesAtTerritory = jest.fn()
const getMyTerritories = jest.fn()
const startTransfer = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getCardInstancesAtTerritory: (...args: unknown[]) => getCardInstancesAtTerritory(...args),
  getMyTerritories: (...args: unknown[]) => getMyTerritories(...args),
  startTransfer: (...args: unknown[]) => startTransfer(...args),
}))

const destinationTerritory: Territory = {
  id: 99,
  x: 5,
  y: 5,
  difficulty: 3,
  castle_rank: null,
  village_rank: null,
  owner_id: 'me',
  is_home: false,
  claim_locked_by: null,
  claim_started_at: null,
  claim_transfer_arrives_at: null,
  claim_occupation_completes_at: null,
  battle_locked_by: null,
}

const unitCard = {
  instance_id: 'inst-1',
  template_id: 'tmpl-1',
  owner_id: 'me',
  stationed_territory_id: 1,
  status: 'stationed' as const,
  card_templates: {
    id: 'tmpl-1',
    name: 'Elitní rytíři',
    flavor_text: 'Silná jízda.',
    rank: 'rare',
    category: 'unit' as const,
    unit_type: 'knights',
    base_stats: { str: 20, lng: 5, def: 15, hp: 30 },
    total_supply: null,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
  },
}

const structureCard = {
  instance_id: 'inst-2',
  template_id: 'tmpl-2',
  owner_id: 'me',
  stationed_territory_id: 1,
  status: 'stationed' as const,
  card_templates: {
    id: 'tmpl-2',
    name: 'Strážní věž',
    flavor_text: 'Pevná stavba.',
    rank: 'common',
    category: 'castle' as const,
    unit_type: null,
    base_stats: null,
    total_supply: null,
    defense_bonus_pct: 10,
    attack_bonus_pct: 5,
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('TransferModal', () => {
  beforeEach(() => {
    getCardInstancesAtTerritory.mockReset()
    getMyTerritories.mockReset()
    startTransfer.mockReset()
    getMyTerritories.mockResolvedValue({
      data: [
        { id: 99, x: 5, y: 5, is_home: false },
        { id: 1, x: 0, y: 0, is_home: true },
        { id: 2, x: 3, y: 4, is_home: false },
      ],
      error: null,
    })
  })

  it('lists only other owned territories, loads unit cards, and calls startTransfer', async () => {
    const onTransferred = jest.fn()
    getCardInstancesAtTerritory.mockResolvedValue({
      data: [unitCard, structureCard],
      error: null,
    })
    startTransfer.mockResolvedValue({ data: 'movement-1', error: null })

    render(
      <TransferModal
        territory={destinationTerritory}
        myPlayerId="me"
        onClose={jest.fn()}
        onTransferred={onTransferred}
      />
    )

    const select = (await screen.findByLabelText('Odkud přesouváš')) as HTMLSelectElement
    await waitFor(() => expect(getMyTerritories).toHaveBeenCalledWith('me'))
    const options = Array.from(select.options).map((o) => o.textContent)
    expect(options).toEqual(['— vyber území —', 'Domov (0, 0)', 'Území (3, 4)'])

    fireEvent.change(select, { target: { value: '1' } })

    await waitFor(() => expect(getCardInstancesAtTerritory).toHaveBeenCalledWith(1))
    expect(await screen.findByText('Elitní rytíři')).toBeInTheDocument()
    expect(screen.queryByText('Strážní věž')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Elitní rytíři').closest('label')!)
    fireEvent.click(screen.getByRole('button', { name: /Přesunout/ }))

    await waitFor(() => expect(startTransfer).toHaveBeenCalledWith(1, 99, ['inst-1']))
    expect(onTransferred).toHaveBeenCalled()
  })

  it('surfaces start_transfer errors inline', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [unitCard], error: null })
    startTransfer.mockResolvedValue({ data: null, error: { message: 'Nelze přesunout všechna vybraná vojska.' } })

    render(<TransferModal territory={destinationTerritory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.change(await screen.findByLabelText('Odkud přesouváš'), { target: { value: '1' } })
    await screen.findByText('Elitní rytíři')

    fireEvent.click(screen.getByText('Elitní rytíři').closest('label')!)
    fireEvent.click(screen.getByRole('button', { name: /Přesunout/ }))

    expect(await screen.findByText('Nelze přesunout všechna vybraná vojska.')).toBeInTheDocument()
  })

  it('ignores stale origin loads when the player quickly switches origin territory', async () => {
    const first = deferred<{ data: typeof unitCard[]; error: null }>()
    const second = deferred<{ data: typeof unitCard[]; error: null }>()
    getCardInstancesAtTerritory
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    render(<TransferModal territory={destinationTerritory} myPlayerId="me" onClose={jest.fn()} />)

    const select = await screen.findByLabelText('Odkud přesouváš')
    fireEvent.change(select, { target: { value: '1' } })
    fireEvent.change(select, { target: { value: '2' } })

    second.resolve({
      data: [
        {
          ...unitCard,
          instance_id: 'inst-2b',
          card_templates: {
            ...unitCard.card_templates,
            name: 'Jezdci z druhé državy',
          },
        },
      ],
      error: null,
    })
    first.resolve({
      data: [unitCard],
      error: null,
    })

    expect(await screen.findByText(/Jezdci z druhé državy/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Elitní rytíři')).not.toBeInTheDocument())
  })

  it('clears the loading state if the player deselects the origin while units are still loading', async () => {
    const pending = deferred<{ data: typeof unitCard[]; error: null }>()
    getCardInstancesAtTerritory.mockReturnValueOnce(pending.promise)

    render(<TransferModal territory={destinationTerritory} myPlayerId="me" onClose={jest.fn()} />)

    const select = await screen.findByLabelText('Odkud přesouváš')
    fireEvent.change(select, { target: { value: '1' } })
    expect(await screen.findByText('Načítám vojska…')).toBeInTheDocument()

    fireEvent.change(select, { target: { value: '' } })

    await waitFor(() => expect(screen.queryByText('Načítám vojska…')).not.toBeInTheDocument())
  })
})
