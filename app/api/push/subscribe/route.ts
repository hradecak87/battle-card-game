import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

interface PushSubscriptionBody {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization')

  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  return authorization.slice('Bearer '.length).trim() || null
}

function isValidSubscriptionBody(body: unknown): body is PushSubscriptionBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { endpoint?: unknown }).endpoint === 'string' &&
    typeof (body as { keys?: { p256dh?: unknown } }).keys?.p256dh === 'string' &&
    typeof (body as { keys?: { auth?: unknown } }).keys?.auth === 'string'
  )
}

function createAuthenticatedSupabaseClient(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  )
}

export async function POST(request: Request) {
  const accessToken = getBearerToken(request)

  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAuthenticatedSupabaseClient(accessToken)
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)

  if (!isValidSubscriptionBody(body)) {
    return NextResponse.json({ error: 'Invalid push subscription payload' }, { status: 400 })
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      player_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    },
    {
      onConflict: 'endpoint',
    },
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
