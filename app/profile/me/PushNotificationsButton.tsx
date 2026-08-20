'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase/client'

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)

  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

export function PushNotificationsButton() {
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleEnableNotifications() {
    setMessage(null)

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setMessage('Tento prohlížeč nepodporuje push oznámení.')
      return
    }

    const notificationApi = globalThis.Notification

    if (!notificationApi || typeof notificationApi.requestPermission !== 'function') {
      setMessage('Tento prohlížeč nepodporuje push oznámení.')
      return
    }

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

    if (!publicKey) {
      setMessage('Chybí veřejný VAPID klíč.')
      return
    }

    const permission = await notificationApi.requestPermission()

    if (permission === 'denied') {
      setMessage('Oznámení byla v prohlížeči zablokována.')
      return
    }

    if (permission !== 'granted') {
      setMessage('Povolení oznámení nebylo uděleno.')
      return
    }

    setIsSubmitting(true)

    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      const existingSubscription = await registration.pushManager.getSubscription()
      const subscription =
        existingSubscription ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }))
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setMessage('Nejsi přihlášený/á.')
        return
      }

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(subscription.toJSON()),
      })

      if (!response.ok) {
        setMessage('Nepodařilo se uložit odběr oznámení.')
        return
      }

      setMessage('Oznámení byla povolena.')
    } catch {
      setMessage('Nepodařilo se povolit oznámení.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="w-full max-w-xl rounded-lg border border-zinc-800 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Push oznámení</h2>
          <p className="text-sm text-zinc-400">
            Aktivuj upozornění na útoky, zprávy, obchod a další herní události.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleEnableNotifications()}
          disabled={isSubmitting}
          className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Povoluji…' : 'Povolit oznámení'}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-zinc-400">{message}</p> : null}
    </section>
  )
}
