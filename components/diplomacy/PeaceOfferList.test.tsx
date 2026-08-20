import { fireEvent, render, screen } from '@testing-library/react'
import { PeaceOfferList } from './PeaceOfferList'

const incomingOffer = {
  id: 'offer-1',
  initiator_id: 'player-2',
  initiator_display_name: 'Karel',
  target_id: 'me',
  target_display_name: 'Já',
  kind: 'tribute_peace' as const,
  offered_card_ids: ['card-1'],
  offered_territory_id: 15,
  offered_territory_name: 'Pohraničí',
  offered_territory_x: 7,
  offered_territory_y: 8,
  status: 'pending' as const,
  created_at: '2026-08-20T10:00:00.000Z',
  expires_at: '2026-08-23T10:00:00.000Z',
  resolved_at: null,
  offered_cards: [
    {
      instance_id: 'card-1',
      template_id: 'archers-common-01',
      owner_id: 'player-2',
      stationed_territory_id: 1,
      status: 'stationed' as const,
      template_name: 'Práčata',
      template_rank: 'common' as const,
      template_unit_type: 'archers' as const,
      template_flavor_text: 'Text',
      template_base_stats: { str: 1, lng: 8, def: 2, hp: 4, speed: 6 },
      template_total_supply: null,
    },
  ],
}

describe('PeaceOfferList', () => {
  it('renders incoming offer details with actions and map link', () => {
    const onAccept = jest.fn()
    const onReject = jest.fn()

    render(
      <PeaceOfferList
        offers={[incomingOffer]}
        currentPlayerId="me"
        onAccept={onAccept}
        onReject={onReject}
        onCancel={jest.fn()}
      />,
    )

    expect(screen.getByText('Karel')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Pohraničí \(7, 8\)/ })).toHaveAttribute('href', '/map?x=7&y=8')

    fireEvent.click(screen.getByRole('button', { name: 'Přijmout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Odmítnout' }))

    expect(onAccept).toHaveBeenCalledWith('offer-1')
    expect(onReject).toHaveBeenCalledWith('offer-1')
  })

  it('renders outgoing offer with cancel action and full-width card blocks', () => {
    const onCancel = jest.fn()

    render(
      <PeaceOfferList
        offers={[{ ...incomingOffer, id: 'offer-2', initiator_id: 'me', target_id: 'player-2', target_display_name: 'Karel' }]}
        currentPlayerId="me"
        onAccept={jest.fn()}
        onReject={jest.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Zrušit nabídku' }))
    expect(onCancel).toHaveBeenCalledWith('offer-2')
    expect(screen.getByText('Odchozí nabídka').closest('article')).toHaveClass('w-full')
  })
})
