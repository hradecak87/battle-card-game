import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import DeclareAttackModal from './DeclareAttackModal'
import { Territory } from '@/lib/territories/api'

const getCardInstancesAtTerritory = jest.fn()
const declareAttack = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getCardInstancesAtTerritory: (...args: unknown[]) => getCardInstancesAtTerritory(...args),
}))

jest.mock('@/lib/battles/api', () => ({
  declareAttack: (...args: unknown[]) => declareAttack(...args),
}))

const territory: Territory = {
  id: 99,
  x: 5,
  y: 5,
  difficulty: 3,
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

const myCard = {
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

describe('DeclareAttackModal', () => {
  beforeEach(() => {
    getCardInstancesAtTerritory.mockReset()
    declareAttack.mockReset()
  })

  it('loads origin cards, selects one, and calls declareAttack', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })
    declareAttack.mockResolvedValue({ data: 'movement-1', error: null })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} onDeclared={jest.fn()} />)

    fireEvent.change(screen.getByLabelText('Původní území'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Načíst vojska' }))

    await waitFor(() => expect(getCardInstancesAtTerritory).toHaveBeenCalledWith(1))
    expect(await screen.findByText('Elitní rytíři')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Elitní rytíři').closest('label')!)
    const submit = screen.getByRole('button', { name: /Zaútočit/ })
    fireEvent.click(submit)

    await waitFor(() => expect(declareAttack).toHaveBeenCalledWith(1, 99, ['inst-1']))
    expect(await screen.findByText(/Útok vyslán/)).toBeInTheDocument()
  })

  it('surfaces declare_attack errors inline', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })
    declareAttack.mockResolvedValue({ data: null, error: { message: 'territory ownership cap (32) reached' } })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.change(screen.getByLabelText('Původní území'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Načíst vojska' }))
    await screen.findByText('Elitní rytíři')

    fireEvent.click(screen.getByText('Elitní rytíři').closest('label')!)
    fireEvent.click(screen.getByRole('button', { name: /Zaútočit/ }))

    expect(await screen.findByText('territory ownership cap (32) reached')).toBeInTheDocument()
  })
})
