import { render, screen } from '@testing-library/react'
import RosterStrip from './RosterStrip'
import { BattleCard } from '@/lib/battles/api'

function makeCard(instanceId: string): BattleCard {
  return {
    instance_id: instanceId,
    owner_id: 'player-1',
    status: 'stationed',
    is_resting: false,
    template: {
      id: `template-${instanceId}`,
      category: 'unit',
      unit_type: 'archers',
      rank: 'common',
      name: `Karta ${instanceId}`,
      flavor_text: 'Střílí zpovzdálí.',
      base_stats: { str: 5, lng: 15, def: 5, hp: 20 },
      defense_bonus_pct: null,
      attack_bonus_pct: null,
      total_supply: null,
      minted_count: 1,
    },
  }
}

describe('RosterStrip', () => {
  it('keeps the mobile roster width constrained and uses a snap-scrolling card row', () => {
    render(
      <RosterStrip
        title="Útočník"
        cards={[
          makeCard('card-1'),
          makeCard('card-2'),
          makeCard('card-3'),
          makeCard('card-4'),
          makeCard('card-5'),
        ]}
      />
    )

    expect(screen.getByTestId('roster-strip')).toHaveClass('w-full', 'max-w-full', 'min-w-0')

    const scrollRow = screen.getByTestId('roster-scroll')
    expect(scrollRow).toHaveClass('flex-row', 'min-w-0', 'overflow-x-auto', 'snap-x', 'snap-mandatory')
    expect(scrollRow.className).toContain('md:flex-col')
    expect(scrollRow.className).toContain('md:overflow-visible')

    const firstCard = screen.getByTestId('roster-card-card-1')
    expect(firstCard).toHaveClass('shrink-0', 'snap-start')
    expect(firstCard.className).toContain('w-[4.875rem]')
    expect(firstCard.className).toContain('md:w-full')
  })

  it('uses a tight inset selection ring for active and preview cards', () => {
    render(
      <RosterStrip
        title="Obránce"
        cards={[makeCard('active-card'), makeCard('preview-card')]}
        activeInstanceId="active-card"
        previewInstanceId="preview-card"
      />
    )

    const activeCard = screen.getByTestId('roster-card-active-card')
    expect(activeCard).toHaveClass('ring-2', 'ring-inset', 'ring-amber-400')
    expect(activeCard).not.toHaveClass('ring-offset-2', 'ring-offset-1')

    const previewCard = screen.getByTestId('roster-card-preview-card')
    expect(previewCard).toHaveClass('ring-2', 'ring-inset', 'ring-sky-400')
    expect(previewCard).not.toHaveClass('ring-offset-2', 'ring-offset-1')
  })
})
