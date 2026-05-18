const FREE_EMAIL_DOMAINS = new Set<string>([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.fr',
  'hotmail.com',
  'hotmail.fr',
  'live.com',
  'live.fr',
  'msn.com',
  'yahoo.com',
  'yahoo.fr',
  'ymail.com',
  'rocketmail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'tutanota.com',
  'tuta.io',
  'gmx.com',
  'gmx.fr',
  'mail.com',
  'zoho.com',
  'fastmail.com',
  'free.fr',
  'orange.fr',
  'wanadoo.fr',
  'laposte.net',
  'sfr.fr',
  'bbox.fr',
  'numericable.fr',
  'club-internet.fr',
  'neuf.fr',
  'noos.fr',
  'cegetel.net',
  'aliceadsl.fr',
  'voila.fr',
  'caramail.com',
  'hushmail.com',
  'inbox.com',
  'yandex.com',
  'yandex.ru',
  'mailinator.com',
  'temp-mail.org',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'throwaway.email',
])

const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

export type EmailValidationError =
  | 'email_empty'
  | 'email_invalid_format'
  | 'email_free_provider'

export interface EmailValidationResult {
  ok: boolean
  error?: EmailValidationError
  email?: string
  domain?: string
}

export function validateProEmail(raw: unknown): EmailValidationResult {
  if (typeof raw !== 'string') return { ok: false, error: 'email_empty' }
  const email = raw.trim().toLowerCase()
  if (!email) return { ok: false, error: 'email_empty' }
  if (!EMAIL_REGEX.test(email)) return { ok: false, error: 'email_invalid_format' }
  const domain = email.slice(email.lastIndexOf('@') + 1)
  if (FREE_EMAIL_DOMAINS.has(domain)) {
    return { ok: false, error: 'email_free_provider', email, domain }
  }
  return { ok: true, email, domain }
}

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase())
}
