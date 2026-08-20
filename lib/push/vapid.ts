function getRequiredEnv(name: 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }

  return value
}

export function getVapidConfig() {
  return {
    publicKey: getRequiredEnv('VAPID_PUBLIC_KEY'),
    privateKey: getRequiredEnv('VAPID_PRIVATE_KEY'),
    subject: getRequiredEnv('VAPID_SUBJECT'),
  }
}
