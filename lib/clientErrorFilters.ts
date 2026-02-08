const EXTENSION_PROTOCOL_PREFIXES = ['chrome-extension://', 'moz-extension://', 'safari-web-extension://']
const KNOWN_EXTENSION_IDS = ['nkbihfbeogaeaoehlefnkodbefgpgknn']

const normalizeText = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.toLowerCase()
  if (value instanceof Error) return `${value.message}\n${value.stack || ''}`.toLowerCase()
  return String(value).toLowerCase()
}

const collectErrorText = (payload: {
  message?: unknown
  filename?: unknown
  stack?: unknown
  reason?: unknown
  args?: unknown[]
}) => {
  const parts = [
    payload.message,
    payload.filename,
    payload.stack,
    payload.reason,
    ...(Array.isArray(payload.args) ? payload.args : []),
  ]
    .map(normalizeText)
    .filter(Boolean)
  return parts.join('\n')
}

export const isBrowserExtensionError = (payload: {
  message?: unknown
  filename?: unknown
  stack?: unknown
  reason?: unknown
  args?: unknown[]
}) => {
  const text = collectErrorText(payload)
  if (!text) return false

  if (EXTENSION_PROTOCOL_PREFIXES.some((prefix) => text.includes(prefix))) return true
  if (KNOWN_EXTENSION_IDS.some((id) => text.includes(id))) return true

  // MetaMask occasionally reports only by name in the message/rejection reason.
  if (text.includes('metamask') && text.includes('failed to connect')) return true

  return false
}
