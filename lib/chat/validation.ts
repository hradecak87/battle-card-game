export function isValidMessageBody(body: string) {
  const trimmed = body.trim()
  return trimmed.length >= 1 && trimmed.length <= 500
}
