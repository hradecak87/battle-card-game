import { fireEvent, render, screen } from '@testing-library/react'
import RoundHistory from './RoundHistory'
import { BattleCard, BattleRoundRow, BattleCardTemplate } from '@/lib/battles/api'

function makeTemplate(overrides: Partial<BattleCardTemplate> = {}): BattleCardTemplate {
  return {
    id: 'archers-common-01',
    category: 'unit',
    unit_type: 'archers',
    rank: 'common',
    name: 'Elitní lučištníci',
    flavor_text: 'Střílí zpovzdálí.',
    base_stats: { str: 5, lng: 15, def: 5, hp: 20, speed: 5 },
    defense_bonus_pct: null,
    attack_bonus_pct: null,
    total_supply: null,
    minted_count: 1,
    ...overrides,
  }
}

function makeCard(instanceId: string, template: BattleCardTemplate): BattleCard {
  return {
    instance_id: instanceId,
    owner_id: 'player-1',
    status: 'stationed',
    template,
    is_resting: false,
    times_used: 0,
  }
}

function makeRound(overrides: Partial<BattleRoundRow> = {}): BattleRoundRow {
  return {
    id: 'round-1',
    battle_id: 'battle-1',
    round_number: 1,
    attacker_card_instance_id: 'atk-1',
    defender_card_instance_id: '123e4567-e89b-12d3-a456-426614174000',
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
      instance_id: '123e4567-e89b-12d3-a456-426614174000',
      template: makeTemplate({ id: 'spearmen-common-01', name: 'Oštěpníci', unit_type: 'spearmen' }),
    },
    ...overrides,
  }
}

describe('RoundHistory', () => {
  it('uses historical round card snapshots when the live defender pool no longer contains a captured card', () => {
    render(
      <RoundHistory
        rounds={[makeRound()]}
        attackerRoster={[makeCard('atk-1', makeTemplate())]}
        defenderPool={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Historie kol/i }))

    expect(screen.getByText(/Elitní lučištníci vs Oštěpníci/i)).toBeInTheDocument()
    expect(screen.queryByText('123e4567-e89b-12d3-a456-426614174000')).not.toBeInTheDocument()
  })
})
