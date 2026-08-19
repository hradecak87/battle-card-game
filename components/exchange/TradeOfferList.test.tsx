import userEvent from '@testing-library/user-event'
import { render, screen } from '@testing-library/react'
import { TradeOfferList } from './TradeOfferList'
import type { TradeOffer } from '@/lib/trading/api'

const unitTradeFields = {
  template_category: 'unit' as const,
  template_boost_type: null,
  template_effect_kind: null,
  template_instant_effect_kind: null,
  template_pct_str: null,
  template_pct_lng: null,
  template_pct_def: null,
  template_pct_hp: null,
}

const offer: TradeOffer = {
  id: 'offer-1',
  type: 'direct',
  status: 'pending',
  initiator_id: 'player-1',
  initiator_display_name: 'Král Artuš',
  target_player_id: 'player-2',
  target_display_name: 'Karel',
  parent_offer_id: null,
  root_offer_id: 'offer-1',
  offered_card_ids: ['card-1'],
  requested_card_ids: ['card-2'],
  requested_criteria: null,
  message: 'Vyměníme luky za kopí?',
  created_at: '2026-08-17T10:00:00Z',
  expires_at: '2026-08-20T10:00:00Z',
  resolved_at: null,
  offered_cards: [
    {
      instance_id: 'card-1',
      template_id: 'archers-common-1',
      owner_id: 'player-1',
      stationed_territory_id: 10,
      status: 'stationed',
      template_name: 'Lučištníci',
      template_rank: 'common',
      template_unit_type: 'archers',
      template_flavor_text: 'Hlídka z pohraničí.',
      template_base_stats: { str: 5, lng: 10, def: 4, hp: 8, speed: 5 },
      template_total_supply: null,
      ...unitTradeFields,
    },
  ],
  requested_cards: [
    {
      instance_id: 'card-2',
      template_id: 'spearmen-common-1',
      owner_id: 'player-2',
      stationed_territory_id: 20,
      status: 'stationed',
      template_name: 'Kopiníci',
      template_rank: 'common',
      template_unit_type: 'spearmen',
      template_flavor_text: 'Drží linii.',
      template_base_stats: { str: 6, lng: 2, def: 6, hp: 9, speed: 5 },
      template_total_supply: null,
      ...unitTradeFields,
    },
  ],
}

describe('TradeOfferList', () => {
  it('renders the core offer summary data', () => {
    render(<TradeOfferList offers={[offer]} emptyMessage="Nic tu není." onSelect={jest.fn()} />)

    expect(screen.getByText('Král Artuš')).toBeInTheDocument()
    expect(screen.getByText('Karel')).toBeInTheDocument()
    expect(screen.getByText('Vyměníme luky za kopí?')).toBeInTheDocument()
    expect(screen.getAllByText('Lučištníci').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Kopiníci').length).toBeGreaterThan(0)
  })

  it('renders zoomable card thumbnails for offered and requested cards', () => {
    render(<TradeOfferList offers={[offer]} emptyMessage="Nic tu není." onSelect={jest.fn()} />)

    expect(screen.getByRole('button', { name: 'Zvětšit kartu Lučištníci' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zvětšit kartu Kopiníci' })).toBeInTheDocument()
    expect(screen.getAllByText('Common').length).toBeGreaterThan(0)
  })

  it('opens card zoom without selecting the offer', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()

    render(<TradeOfferList offers={[offer]} emptyMessage="Nic tu není." onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Zvětšit kartu Lučištníci' }))

    expect(screen.getByTestId('card-zoom-modal')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('still selects the offer when the offer card is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()

    render(<TradeOfferList offers={[offer]} emptyMessage="Nic tu není." onSelect={onSelect} />)

    await user.click(screen.getByText('Vyměníme luky za kopí?'))

    expect(onSelect).toHaveBeenCalledWith(offer)
  })
})
