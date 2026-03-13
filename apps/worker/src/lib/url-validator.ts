import { URL } from 'node:url'
import { isIP } from 'node:net'

/**
 * Validate a URL before fetching, blocking private/internal addresses (SSRF protection).
 * Returns the validated URL string, or throws if blocked.
 */
export function validateExternalUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL format')
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL protocol: ${parsed.protocol}`)
  }

  const hostname = parsed.hostname.toLowerCase()

  // Block localhost variants
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error('Blocked URL: localhost is not allowed')
  }

  // Block AWS/cloud metadata endpoints
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    throw new Error('Blocked URL: cloud metadata endpoint')
  }

  // Block private IP ranges
  if (isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error('Blocked URL: private IP address')
    }
  }

  // Block common internal hostnames
  const blockedPrefixes = ['redis', 'postgres', 'mysql', 'minio', 'internal', 'k8s', 'consul', 'vault']
  for (const prefix of blockedPrefixes) {
    if (hostname === prefix || hostname.startsWith(`${prefix}.`) || hostname.startsWith(`${prefix}-`)) {
      throw new Error(`Blocked URL: internal hostname pattern "${hostname}"`)
    }
  }

  return rawUrl
}

function isPrivateIP(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false

  const [a, b] = parts
  // 10.0.0.0/8
  if (a === 10) return true
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true
  // 127.0.0.0/8
  if (a === 127) return true
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true
  // 0.0.0.0/8
  if (a === 0) return true
  return false
}
