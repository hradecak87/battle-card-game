import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import BattleScreen from './BattleScreen'
import { GetBattleResult } from '@/lib/battles/api'

const getBattle = jest.fn()
const markReady = jest.fn().mockResolvedValue({ error: null })
const pickDefenderCard = jest.fn().mockResolvedValue({ error: null })

jest.mock('@/lib/battles/api', () => ({
  getBattle: (...args: unknown[]) => getBattle(...args),
  markReady: (...args: unknown[]) => markReady(...args),
  pickDefenderCard: (...args: unknown[]) => pickDefenderCard(...args),
}))

jest.mock('@/lib/battles/useBattleChannel', () => ({
  useBattleChannel: jest.fn(),
}))

function makeTemplate(overrides: Partial<GetBattleResult['attacker_roster'][number]['template']> = {}) {
  return {
    id: 'archers-common-01',
    category: 'unit' as const,
    unit_type: 'archers',
    rank: 'common',
    name: 'Elitní lučištníci',
    flavor_text: 'Střílí zpovzdálí.',
    base_stats: { str: 5, lng: 15, def: 5, hp: 20 },
    defense_bonus_pct: null,
    attack_bonus_pct: null,
    total_supply: null,
    minted_count: 1,
    ...overrides,
  }
}

const attackerCard = {
  instance_id: 'atk-1',
  owner_id: 'attacker-1',
  status: 'stationed' as const,
  template: makeTemplate(),
  is_resting: false,
}

const defenderCard = {
  instance_id: 'def-1',
  owner_id: 'defender-1',
  status: 'stationed' as const,
  template: makeTemplate({ id: 'spearmen-common-01', name: 'Oštěpníci', unit_type: 'spearmen' }),
  is_resting: false,
}

function awaitingReadyFixture(): GetBattleResult {
  return {
    battle: {
      id: 'battle-1',
      territory_id: 10,
      attacker_id: 'attacker-1',
      defender_id: 'defender-1',
      is_home_target: false,
      movement_id: 'mv-1',
      status: 'awaiting_ready',
      attacker_ready_at: null,
      defender_ready_at: null,
      ready_deadline: new Date(Date.now() + 3600_000).toISOString(),
      current_round: 0,
      round_deadline: null,
      winner_side: null,
      resolved_at: null,
      created_at: new Date().toISOString(),
    },
    attacker_roster: [attackerCard],
    defender_pool: [defenderCard],
    rounds: [],
  }
}

function activeFixture(): GetBattleResult {
  const fixture = awaitingReadyFixture()
  fixture.battle.status = 'active'
  fixture.battle.attacker_ready_at = new Date().toISOString()
  fixture.battle.defender_ready_at = new Date().toISOString()
  fixture.battle.round_deadline = new Date(Date.now() + 120_000).toISOString()
  fixture.rounds = [
    {
      id: 'round-1',
      battle_id: 'battle-1',
      round_number: 1,
      attacker_card_instance_id: 'atk-1',
      defender_card_instance_id: null,
      winner_card_instance_id: null,
      auto_picked: false,
      skipped: false,
      resolved_at: null,
    },
  ]
  return fixture
}

describe('BattleScreen', () => {
  beforeEach(() => {
    getBattle.mockReset()
    markReady.mockClear()
    pickDefenderCard.mockClear()
  })

  it('shows a ready button for the attacker while awaiting_ready and calls markReady', async () => {
    getBattle.mockResolvedValue({ data: awaitingReadyFixture(), error: null })
    render(<BattleScreen battleId="battle-1" currentUserId="attacker-1" />)

    const readyButton = await screen.findByRole('button', { name: 'Jsem připraven' })
    fireEvent.click(readyButton)

    await waitFor(() => expect(markReady).toHaveBeenCalledWith('battle-1'))
  })

  it('keeps silently re-calling markReady while both sides are ready but not yet online together', async () => {
    const fixture = awaitingReadyFixture()
    fixture.battle.attacker_ready_at = new Date().toISOString()
    fixture.battle.defender_ready_at = new Date().toISOString()
    getBattle.mockResolvedValue({ data: fixture, error: null })

    jest.useFakeTimers()
    render(<BattleScreen battleId="battle-1" currentUserId="defender-1" />)

    // Flush the initial getBattle() promise and resulting re-render.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getBattle).toHaveBeenCalledTimes(1)
    // No "Jsem připraven" button anymore — both already marked ready — yet
    // the screen should keep retrying the joint online check in the
    // background instead of leaving the battle stuck forever.
    expect(screen.queryByRole('button', { name: 'Jsem připraven' })).not.toBeInTheDocument()

    await act(async () => {
      await jest.advanceTimersByTimeAsync(20_000)
    })

    expect(markReady).toHaveBeenCalledWith('battle-1')
    expect(getBattle).toHaveBeenCalledTimes(2)

    jest.useRealTimers()
  })

  it("renders the pending round's attacker card and lets the defender pick a card", async () => {
    getBattle.mockResolvedValue({ data: activeFixture(), error: null })
    render(<BattleScreen battleId="battle-1" currentUserId="defender-1" />)

    await waitFor(() => expect(screen.getByTestId('duel-stage')).toBeInTheDocument())
    expect(within(screen.getByTestId('duel-stage')).getByText('Elitní lučištníci')).toBeInTheDocument()

    const defenderRosterCard = screen.getByTestId('roster-card-def-1')
    expect(defenderRosterCard).not.toBeDisabled()
    fireEvent.click(defenderRosterCard)

    await waitFor(() => expect(pickDefenderCard).toHaveBeenCalledWith('battle-1', 'def-1'))
  })

  it('disables the defender roster when the current user is not the defender', async () => {
    getBattle.mockResolvedValue({ data: activeFixture(), error: null })
    render(<BattleScreen battleId="battle-1" currentUserId="attacker-1" />)

    await waitFor(() => expect(screen.getByTestId('duel-stage')).toBeInTheDocument())
    expect(screen.getByTestId('roster-card-def-1')).toBeDisabled()
  })

  it('shows the current user their role in the battle (attacker/defender/spectator)', async () => {
    getBattle.mockResolvedValue({ data: activeFixture(), error: null })
    const { rerender } = render(<BattleScreen battleId="battle-1" currentUserId="attacker-1" />)
    await waitFor(() => expect(screen.getByTestId('my-role')).toHaveTextContent('útočník'))

    rerender(<BattleScreen battleId="battle-1" currentUserId="defender-1" />)
    await waitFor(() => expect(screen.getByTestId('my-role')).toHaveTextContent('obránce'))

    rerender(<BattleScreen battleId="battle-1" currentUserId="someone-else" />)
    await waitFor(() => expect(screen.getByTestId('my-role')).toHaveTextContent('divák'))
  })

  it('shows the winner banner once the battle is resolved', async () => {
    const fixture = activeFixture()
    fixture.battle.status = 'resolved'
    fixture.battle.winner_side = 'attacker'
    getBattle.mockResolvedValue({ data: fixture, error: null })
    render(<BattleScreen battleId="battle-1" currentUserId="attacker-1" />)

    expect(await screen.findByText('Vítězí útočník')).toBeInTheDocument()
  })
})
