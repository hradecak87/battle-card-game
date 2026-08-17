import { supabase } from '@/lib/supabase/client'
import type { Rank } from '@/lib/cards/types'

export interface DailyRewardGrant {
  template_id: string
  rank: Rank
}

export interface ClaimDailyRewardResult {
  streak: number
  claimed_at: string
  granted_cards: DailyRewardGrant[]
}

export async function claimDailyReward() {
  return supabase.rpc('claim_daily_reward') as unknown as Promise<{
    data: ClaimDailyRewardResult | null
    error: { message: string } | null
  }>
}
