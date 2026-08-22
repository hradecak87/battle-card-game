import { formatMaskedUnitBuckets, summarizeMaskedUnitBuckets } from './garrisonBuckets'
import type { CardInstanceWithTemplate } from '@/lib/territories/api'

const maskedInstance = (rank: 'common' | 'uncommon') =>
  ({
    instance_id: `masked-${rank}`,
    template_id: 'masked-unit',
    owner_id: null,
    status: 'stationed',
    stationed_territory_id: 1,
    card_templates: {
      id: 'masked-unit',
      category: 'unit',
      unit_type: null,
      rank,
      name: null,
      flavor_text: null,
      base_stats: null,
      defense_bonus_pct: null,
      attack_bonus_pct: null,
      total_supply: null,
      boost_type: null,
      effect_kind: null,
      instant_effect_kind: null,
      pct_str: null,
      pct_lng: null,
      pct_def: null,
      pct_hp: null,
    },
    is_masked: true,
  }) as CardInstanceWithTemplate

describe('garrisonBuckets', () => {
  it('formats masked unit counts into rank bucket ranges', () => {
    const summary = summarizeMaskedUnitBuckets([
      maskedInstance('common'),
      maskedInstance('common'),
      maskedInstance('uncommon'),
    ])

    expect(summary).toBe('1–5 common, 1–5 uncommon')
  })

  it('maps higher counts to later display buckets', () => {
    expect(formatMaskedUnitBuckets({ common: 7, rare: 12 })).toBe('6–10 common, 11+ rare')
  })
})
