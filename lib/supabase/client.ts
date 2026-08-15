import { createClient } from '@supabase/supabase-js'

/**
 * Single browser Supabase client for the whole app. Reads the public URL
 * + anon key from env (see .env.local, gitignored). All writes go through
 * RLS + the security-definer RPC functions defined in
 * supabase/migrations/0001_players.sql — the anon key alone can never
 * mutate protected columns (design spec §2.2).
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
