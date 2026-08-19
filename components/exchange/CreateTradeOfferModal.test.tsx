import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateTradeOfferModal } from './CreateTradeOfferModal'
import type { TradeOfferDirection, TradePlayerOption, TradeSelectableCard } from '@/lib/trading/api'

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

const ownCards: TradeSelectableCard[] = [
  {
    instance_id: 'card-1',
    template_id: 'archers-common-1',
    owner_id: 'me',
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
]

const targetCards: TradeSelectableCard[] = [
  {
    instance_id: 'card-2',
    template_id: 'spearmen-common-1',
    owner_id: 'target-1',
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
]

const targetPlayers: TradePlayerOption[] = [
  {
    id: 'target-1',
    display_name: 'Král Artuš',
    kingdom_name: 'Camelot',
  },
]

describe('CreateTradeOfferModal', () => {
  async function renderModal(direction: TradeOfferDirection = 'create') {
    const user = userEvent.setup()
    const onClose = jest.fn()
    const onSubmit = jest.fn().mockResolvedValue({ ok: true })

    render(
      <CreateTradeOfferModal
        direction={direction}
        ownCards={ownCards}
        targetPlayers={targetPlayers}
        targetCards={targetCards}
        loadingTargetCards={false}
        onClose={onClose}
        onSubmit={onSubmit}
        onSearchPlayers={jest.fn()}
        onTargetPlayerChange={jest.fn()}
      />
    )

    return { user, onClose, onSubmit }
  }

  it('validates that a direct offer has a selected target, offered cards, and requested cards', async () => {
    const { user, onSubmit } = await renderModal()

    await user.click(screen.getByRole('button', { name: 'Odeslat nabídku' }))

    expect(screen.getByText('Vyber hráče, kterému chceš nabídku poslat.')).toBeInTheDocument()
    expect(screen.getByText('Vyber alespoň jednu svou kartu.')).toBeInTheDocument()
    expect(screen.getByText('Vyber alespoň jednu požadovanou kartu protihráče.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('validates that a public response contains at least one offered card', async () => {
    const { user, onSubmit } = await renderModal('respond')

    await user.click(screen.getByRole('button', { name: 'Odeslat nabídku' }))

    expect(screen.getByText('Vyber alespoň jednu svou kartu.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
