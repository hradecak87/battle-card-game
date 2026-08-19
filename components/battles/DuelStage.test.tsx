import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DuelStage from './DuelStage'
import { BattleCard } from '@/lib/battles/api'

function makeCard(instanceId: string, name: string): BattleCard {
  return {
    instance_id: instanceId,
    owner_id: 'player-1',
    status: 'stationed',
    is_resting: false,
    times_used: 0,
    template: {
      id: `template-${instanceId}`,
      category: 'unit',
      unit_type: 'archers',
      rank: 'common',
      name,
      flavor_text: 'Střílí zpovzdálí.',
      base_stats: { str: 5, lng: 15, def: 5, hp: 20, speed: 5 },
      defense_bonus_pct: null,
      attack_bonus_pct: null,
      total_supply: null,
      minted_count: 1,
    },
  }
}

describe('DuelStage', () => {
  it('opens the zoom modal when a displayed duel card is clicked', async () => {
    const user = userEvent.setup()

    render(
      <DuelStage
        attackerCard={makeCard('atk-1', 'Elitní lučištníci')}
        defenderCard={makeCard('def-1', 'Oceloví střelci')}
        roundNumber={3}
        roundDeadline={null}
        score={{ attacker: 1, defender: 0 }}
        lastWinnerSide={null}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Zvětšit kartu Elitní lučištníci' }))
    expect(screen.getByTestId('card-zoom-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Zavřít detail karty' }))
    expect(screen.queryByTestId('card-zoom-modal')).not.toBeInTheDocument()
  })
})
