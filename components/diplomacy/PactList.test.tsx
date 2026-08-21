import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PactList } from './PactList'
import type { DiplomacyOfferRow, NonAggressionPactRow } from '@/lib/diplomacy/types'

describe('PactList', () => {
  it('renders active pacts, pending offers, and the proposal form', async () => {
    const onPropose = jest.fn().mockResolvedValue(undefined)
    const onAccept = jest.fn().mockResolvedValue(undefined)
    const onCancel = jest.fn().mockResolvedValue(undefined)
    const pacts: NonAggressionPactRow[] = [
      {
        other_player_id: 'player-2',
        other_player_display_name: 'Spojenec',
        other_kingdom_name: 'Sever',
        other_home_x: 11,
        other_home_y: 22,
        pact_started_at: '2026-08-21T10:00:00.000Z',
      },
    ]
    const offers: DiplomacyOfferRow[] = [
      {
        id: 'offer-incoming',
        initiator_id: 'player-3',
        initiator_display_name: 'Vyjednavač',
        target_id: 'me',
        target_display_name: 'Já',
        kind: 'non_aggression',
        offered_card_ids: [],
        offered_territory_id: null,
        offered_territory_name: null,
        offered_territory_x: null,
        offered_territory_y: null,
        status: 'pending',
        created_at: '2026-08-21T10:00:00.000Z',
        expires_at: '2026-08-22T10:00:00.000Z',
        resolved_at: null,
        offered_cards: [],
      },
      {
        id: 'offer-outgoing',
        initiator_id: 'me',
        initiator_display_name: 'Já',
        target_id: 'player-4',
        target_display_name: 'Cíl',
        kind: 'non_aggression',
        offered_card_ids: [],
        offered_territory_id: null,
        offered_territory_name: null,
        offered_territory_x: null,
        offered_territory_y: null,
        status: 'pending',
        created_at: '2026-08-21T10:05:00.000Z',
        expires_at: '2026-08-22T10:05:00.000Z',
        resolved_at: null,
        offered_cards: [],
      },
    ]

    render(
      <PactList
        pacts={pacts}
        offers={offers}
        currentPlayerId="me"
        onPropose={onPropose}
        onAccept={onAccept}
        onReject={jest.fn()}
        onCancel={onCancel}
      />
    )

    expect(screen.getByRole('link', { name: 'Spojenec' })).toHaveAttribute('href', '/map?x=11&y=22')

    fireEvent.change(screen.getByPlaceholderText('ID cílového hráče'), { target: { value: 'player-5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Navrhnout pakt' }))
    await waitFor(() => expect(onPropose).toHaveBeenCalledWith('player-5'))

    fireEvent.click(screen.getByRole('button', { name: 'Přijmout' }))
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith('offer-incoming'))

    fireEvent.click(screen.getByRole('button', { name: 'Zrušit návrh' }))
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('offer-outgoing'))
  })
})
