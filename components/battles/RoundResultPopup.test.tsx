import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import RoundResultPopup from './RoundResultPopup'
import { BattleRoundRow, BattleCardTemplate } from '@/lib/battles/api'

function makeTemplate(overrides: Partial<BattleCardTemplate> = {}): BattleCardTemplate {
  return {
    id: 'archers-common-01',
    category: 'unit',
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

function makeRound(overrides: Partial<BattleRoundRow> = {}): BattleRoundRow {
  return {
    id: 'round-1',
    battle_id: 'battle-1',
    round_number: 1,
    attacker_card_instance_id: 'atk-1',
    defender_card_instance_id: 'def-1',
    winner_card_instance_id: 'atk-1',
    auto_picked: false,
    skipped: false,
    resolved_at: new Date().toISOString(),
    attacker_atk: 15,
    attacker_dmg_dealt: 10,
    attacker_ttk: 2,
    defender_atk: 5,
    defender_dmg_dealt: 0,
    defender_ttk: null,
    attacker_win_probability: 0.97,
    flavor_text: null,
    attacker_card: { instance_id: 'atk-1', template: makeTemplate() },
    defender_card: {
      instance_id: 'def-1',
      template: makeTemplate({ id: 'spearmen-common-01', name: 'Oštěpníci', unit_type: 'spearmen' }),
    },
    ...overrides,
  }
}

function PopupSequenceHarness() {
  const [rounds, setRounds] = useState([
    makeRound({ id: 'round-1', round_number: 1 }),
    makeRound({ id: 'round-2', round_number: 2 }),
  ])

  return rounds[0] ? (
    <RoundResultPopup round={rounds[0]} onDismiss={() => setRounds(([, ...rest]) => rest)} />
  ) : null
}

describe('RoundResultPopup', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders both cards, highlights the winner, and shows the ATK/DMG/TTK breakdown', () => {
    const onDismiss = jest.fn()
    render(<RoundResultPopup round={makeRound()} onDismiss={onDismiss} />)

    expect(screen.getByTestId('round-result-attacker')).toHaveClass('border-amber-500')
    expect(screen.getByTestId('round-result-defender')).not.toHaveClass('border-amber-500')
    expect(screen.getAllByText('VÍTĚZ')).toHaveLength(1)
    expect(screen.getByTestId('round-result-attacker')).toHaveTextContent('15')
    expect(screen.getByTestId('round-result-attacker')).toHaveTextContent('10')
    expect(screen.getByTestId('round-result-defender')).toHaveTextContent('∞')
    expect(screen.getByTestId('round-result-probability')).toHaveTextContent('Šance útočníka na výhru: 97 %')
  })

  it('shows the "never dealt damage" phrasing when a side never scored a hit', () => {
    render(<RoundResultPopup round={makeRound()} onDismiss={jest.fn()} />)
    expect(screen.getByTestId('round-result-explanation')).toHaveTextContent(
      'Útočník zvítězil beze ztrát'
    )
  })

  it('renders the short skipped-round variant with no card art or stats', () => {
    render(
      <RoundResultPopup
        round={makeRound({
          skipped: true,
          attacker_card_instance_id: null,
          defender_card_instance_id: null,
          winner_card_instance_id: null,
          attacker_card: null,
          defender_card: null,
          attacker_atk: null,
          attacker_dmg_dealt: null,
          attacker_ttk: null,
          defender_atk: null,
          defender_dmg_dealt: null,
          defender_ttk: null,
        })}
        onDismiss={jest.fn()}
      />
    )
    expect(screen.getByText('Kolo přeskočeno – všechny karty odpočívají.')).toBeInTheDocument()
    expect(screen.queryByTestId('round-result-attacker')).not.toBeInTheDocument()
  })

  it('shows an upset banner only when the round stored flavor text', () => {
    const { rerender } = render(
      <RoundResultPopup
        round={makeRound({
          winner_card_instance_id: 'def-1',
          attacker_win_probability: 0.82,
          flavor_text: 'Velitel dorazil pozdě, zato panika včas.',
        })}
        onDismiss={jest.fn()}
      />
    )

    expect(screen.getByTestId('round-result-upset')).toHaveTextContent(
      'Zvrat! ⚡ Velitel dorazil pozdě, zato panika včas.'
    )

    rerender(<RoundResultPopup round={makeRound({ flavor_text: null })} onDismiss={jest.fn()} />)
    expect(screen.queryByTestId('round-result-upset')).not.toBeInTheDocument()
  })

  it('auto-dismisses after the 20s countdown reaches zero', () => {
    const onDismiss = jest.fn()
    render(<RoundResultPopup round={makeRound()} onDismiss={onDismiss} />)

    expect(screen.getByTestId('round-result-countdown')).toHaveTextContent('20s')
    act(() => {
      jest.advanceTimersByTime(20_000)
    })
    expect(onDismiss).toHaveBeenCalled()
  })

  it('dismisses immediately when the ✕ button is clicked', () => {
    const onDismiss = jest.fn()
    render(<RoundResultPopup round={makeRound()} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByTestId('round-result-close'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('restarts the full 20s countdown when manually closing one round and showing the next', () => {
    render(<PopupSequenceHarness />)

    act(() => {
      jest.advanceTimersByTime(5_000)
    })
    expect(screen.getByTestId('round-result-countdown')).toHaveTextContent('15s')

    fireEvent.click(screen.getByTestId('round-result-close'))
    expect(screen.getByText('Kolo 2')).toBeInTheDocument()
    expect(screen.getByTestId('round-result-countdown')).toHaveTextContent('20s')

    act(() => {
      jest.advanceTimersByTime(19_000)
    })
    expect(screen.getByTestId('round-result-popup')).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(1_000)
    })
    expect(screen.queryByTestId('round-result-popup')).not.toBeInTheDocument()
  })

  it('restarts the full 20s countdown when one round auto-dismisses and the next is shown', () => {
    render(<PopupSequenceHarness />)

    act(() => {
      jest.advanceTimersByTime(20_000)
    })
    expect(screen.getByText('Kolo 2')).toBeInTheDocument()
    expect(screen.getByTestId('round-result-countdown')).toHaveTextContent('20s')

    act(() => {
      jest.advanceTimersByTime(19_000)
    })
    expect(screen.getByTestId('round-result-popup')).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(1_000)
    })
    expect(screen.queryByTestId('round-result-popup')).not.toBeInTheDocument()
  })
})
