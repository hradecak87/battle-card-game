// One-time NPC kingdom seed script.
//
// Creates one fake auth.users row per requested nation via the Supabase
// service-role admin API, marks the matching public.players row as an NPC,
// then calls the server-side seed_npc_kingdom_setup(...) helper introduced by
// 0027_npc_kingdoms.sql to assign the NPC's home territory and starter army.
//
// Safe to re-run with additional nations later: already-seeded NPC nations are
// skipped. Do NOT run automatically and do NOT point this at the live project
// without an explicit human decision.
//
// Run with:
//   npx ts-node scripts/seed-npc-kingdoms.ts
//   npx ts-node scripts/seed-npc-kingdoms.ts england hre
//   npx ts-node scripts/seed-npc-kingdoms.ts --nations=england,hre

import { createClient } from '@supabase/supabase-js'
import { NationId } from '../lib/players/nations'

if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as any).WebSocket = require('ws')
}

interface NpcKingdomConfig {
  nation: NationId
  displayName: string
  kingdomName: string
  coatOfArmsId: string
}

export const NPC_KINGDOMS: Record<NationId, NpcKingdomConfig> = {
  england: {
    nation: 'england',
    displayName: 'NPC England',
    kingdomName: 'Koruna Albionu',
    coatOfArmsId: 'lion-gold',
  },
  francia: {
    nation: 'francia',
    displayName: 'NPC Francia',
    kingdomName: 'Franské marky',
    coatOfArmsId: 'cross-white',
  },
  hre: {
    nation: 'hre',
    displayName: 'NPC HRE',
    kingdomName: 'Orlí markrabství',
    coatOfArmsId: 'eagle-black',
  },
  byzantium: {
    nation: 'byzantium',
    displayName: 'NPC Byzantium',
    kingdomName: 'Nová Byzanc',
    coatOfArmsId: 'tower-brown',
  },
  mongol_horde: {
    nation: 'mongol_horde',
    displayName: 'NPC Horde',
    kingdomName: 'Stepní horda',
    coatOfArmsId: 'sun-orange',
  },
  scandinavia: {
    nation: 'scandinavia',
    displayName: 'NPC Scandinavia',
    kingdomName: 'Severské jarldomy',
    coatOfArmsId: 'axe-crossed',
  },
}

function parseRequestedNations(argv: string[]): NationId[] {
  const rawArgs = argv
    .flatMap((arg) => (arg.startsWith('--nations=') ? arg.slice('--nations='.length).split(',') : [arg]))
    .map((arg) => arg.trim())
    .filter(Boolean)

  if (rawArgs.length === 0) {
    return Object.keys(NPC_KINGDOMS) as NationId[]
  }

  const unique = Array.from(new Set(rawArgs))
  const invalid = unique.filter((nation) => !(nation in NPC_KINGDOMS))
  if (invalid.length > 0) {
    throw new Error(`Unknown nation id(s): ${invalid.join(', ')}`)
  }
  return unique as NationId[]
}

function randomPassword(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

async function main() {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }

  const requestedNations = parseRequestedNations(process.argv.slice(2))
  const supabase = createClient(url, serviceRoleKey)

  const { data: existingPlayers, error: existingError } = await supabase
    .from('players')
    .select('id, nation')
    .eq('is_npc', true)
    .in('nation', requestedNations)
  if (existingError) throw existingError

  const seededNations = new Set((existingPlayers ?? []).map((player) => player.nation as NationId))

  for (const nation of requestedNations) {
    if (seededNations.has(nation)) {
      console.log(`Skipping ${nation}: NPC kingdom already exists.`)
      continue
    }

    const config = NPC_KINGDOMS[nation]
    const email = `npc-${nation}@system.internal`
    let createdUserId: string | null = null
    let playerId =
      existingPlayers?.find(
        (player) => player.nation === nation
      )?.id ?? null

    if (!playerId) {
      const { data: pendingPlayer, error: pendingPlayerError } = await supabase
        .from('players')
        .select('id, onboarding_completed, is_npc')
        .eq('nation', nation)
        .eq('display_name', config.displayName)
        .maybeSingle()
      if (pendingPlayerError) throw pendingPlayerError
      if (pendingPlayer) {
        playerId = pendingPlayer.id
      }
    }

    try {
      if (!playerId) {
        const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
          email,
          password: randomPassword(),
          email_confirm: true,
          user_metadata: {
            display_name: config.displayName,
            nation: config.nation,
          },
        })
        if (createUserError) throw createUserError
        if (!createdUser.user) {
          throw new Error(`createUser returned no user for ${nation}`)
        }
        createdUserId = createdUser.user.id
        playerId = createdUser.user.id
      } else {
        console.log(`Reusing existing partially seeded player for ${nation} (${playerId}).`)
      }

      const { error: updatePlayerError } = await supabase
        .from('players')
        .update({
          is_npc: true,
          npc_next_action_at: new Date().toISOString(),
        })
        .eq('id', playerId)
      if (updatePlayerError) throw updatePlayerError

      const { error: seedError } = await supabase.rpc('seed_npc_kingdom_setup', {
        p_player_id: playerId,
        new_kingdom_name: config.kingdomName,
        new_coat_of_arms_id: config.coatOfArmsId,
      })
      if (seedError) throw seedError

      console.log(`Seeded NPC kingdom for ${nation} (${playerId}).`)
    } catch (error) {
      if (createdUserId) {
        const { error: deleteUserError } = await supabase.auth.admin.deleteUser(createdUserId)
        if (deleteUserError) {
          console.warn(`Cleanup warning for ${nation} (${createdUserId}): ${deleteUserError.message}`)
        }
      }
      throw error
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
