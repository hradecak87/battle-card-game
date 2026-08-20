'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { NotificationList } from '@/components/notifications/NotificationList'
import { listNotifications } from '@/lib/notifications/api'
import type { NotificationRow } from '@/lib/notifications/types'
import { useSession } from '@/lib/supabase/useSession'

const PAGE_SIZE = 40

export default function NotificationsPage() {
  const router = useRouter()
  const { user, loading } = useSession()
  const userId = user?.id ?? null
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [pageError, setPageError] = useState<string | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  const loadPage = useCallback(
    async (beforeId: number | null, append: boolean) => {
      const { data, error } = await listNotifications(beforeId, PAGE_SIZE)

      if (error) {
        setPageError(error.message)
        return
      }

      const rows = data ?? []
      setPageError(null)
      setHasMore(rows.length === PAGE_SIZE)
      setNotifications((current) => (append ? [...current, ...rows] : rows))
    },
    [],
  )

  const reloadFirstPage = useCallback(async () => {
    await loadPage(null, false)
  }, [loadPage])

  useEffect(() => {
    if (loading) return

    if (!userId) {
      router.push('/login')
      return
    }

    void (async () => {
      setIsInitialLoading(true)
      await reloadFirstPage()
      setIsInitialLoading(false)
    })()
  }, [loading, reloadFirstPage, router, userId])

  async function handleLoadMore() {
    const beforeId = notifications[notifications.length - 1]?.id ?? null
    setIsLoadingMore(true)
    await loadPage(beforeId, true)
    setIsLoadingMore(false)
  }

  if (loading || !userId || isInitialLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="text-zinc-400">Načítám…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">Historie oznámení</h1>
            <p className="mt-1 text-sm text-zinc-400">Posledních 30 dní herních událostí.</p>
          </div>
          <Link href="/profile/me" className="text-sm text-zinc-400 underline transition hover:text-zinc-200">
            ← Zpět na profil
          </Link>
        </div>

        {pageError ? (
          <p className="rounded-2xl border border-red-900/70 bg-red-950/40 p-4 text-sm text-red-200">
            {pageError}
          </p>
        ) : null}

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 sm:p-5">
          <NotificationList
            notifications={notifications}
            emptyText="Zatím nemáš žádná oznámení."
            onRefresh={reloadFirstPage}
          />

          {hasMore ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => void handleLoadMore()}
                disabled={isLoadingMore}
                className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingMore ? 'Načítám…' : 'Načíst další'}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}
