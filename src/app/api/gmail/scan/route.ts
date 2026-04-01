export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { getValidGmailToken } from '@/lib/gmail-tokens'

// Keywords that indicate an invoice / accounting document
const INVOICE_KEYWORDS = [
  'facture', 'invoice', 'avoir', 'credit note',
  'recu', 'receipt', 'quittance',
  'releve', 'echeancier', 'prelevement',
  'decompte', 'bordereau', 'avis',
  'note de frais', 'bon de commande',
  'appel de fonds', 'cotisation',
  'redevance', 'abonnement',
  'contrat', 'mensualite',
]

// Keywords that indicate NON-accounting documents (to exclude)
const EXCLUDE_KEYWORDS = [
  'cv ', 'curriculum', 'candidature', 'postule', 'je postule',
  'stage', 'stagiaire', 'convention de stage',
  'alternance', 'alternant',
  'lettre de motivation', 'recrutement',
  'newsletter', 'inscription', 'bienvenue',
  'confirmation de commande', 'colis', 'livraison',
  'mot de passe', 'password', 'verification',
]

function isLikelyInvoice(subject: string, from: string, filename: string): boolean {
  const subjectLower = subject.toLowerCase()
  const fromLower = from.toLowerCase()
  const filenameLower = filename.toLowerCase()

  // Exclude obvious non-accounting emails
  for (const kw of EXCLUDE_KEYWORDS) {
    if (subjectLower.includes(kw)) return false
  }

  // Exclude if filename looks like a CV or personal doc
  if (filenameLower.includes('cv') || filenameLower.includes('lettre') ||
      filenameLower.includes('stage') || filenameLower.includes('candidat') ||
      filenameLower.includes('diplome') || filenameLower.includes('attestation_stage')) {
    return false
  }

  // Include if subject or filename contains invoice keywords
  for (const kw of INVOICE_KEYWORDS) {
    if (subjectLower.includes(kw) || filenameLower.includes(kw)) return true
  }

  // Include if sender looks like a billing/accounting service
  if (fromLower.includes('factur') || fromLower.includes('compta') ||
      fromLower.includes('billing') || fromLower.includes('invoice') ||
      fromLower.includes('noreply') || fromLower.includes('no-reply') ||
      fromLower.includes('service') || fromLower.includes('paiement') ||
      fromLower.includes('comptabilite')) {
    return true
  }

  // Include if filename contains "facture" or looks like an invoice
  if (/facture|invoice|avoir|fac[_-]?\d|inv[_-]?\d/i.test(filenameLower)) {
    return true
  }

  // Exclude by default — prefer precision over recall
  return false
}

async function gmailFetch(url: string, accessToken: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Gmail API error ${res.status}`)
  }
  return res.json()
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const body = await request.json()
    const { days = 30, sender } = body

    // Get valid token (auto-refresh if expired)
    const accessToken = await getValidGmailToken(decoded.uid)
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Session Gmail expiree. Veuillez vous reconnecter.', reconnect: true },
        { status: 401 }
      )
    }

    // Build a smarter search query targeting invoices
    let query = `has:attachment filename:pdf newer_than:${days}d`

    // Add invoice-oriented terms to narrow results
    query += ' {facture invoice avoir recu releve echeancier quittance contrat abonnement bordereau decompte cotisation}'

    if (sender) {
      query += ` from:${sender}`
    }

    // Search Gmail
    const listData = await gmailFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100`,
      accessToken
    )

    const messageIds = listData.messages || []

    if (messageIds.length === 0) {
      return NextResponse.json({ emails: [], total: 0 })
    }

    // Fetch details for each message
    const emails = await Promise.all(
      messageIds.map(async (msg: { id: string }) => {
        try {
          const detail = await gmailFetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            accessToken
          )

          const headers = detail.payload?.headers || []
          const subject = headers.find((h: { name: string; value: string }) => h.name === 'Subject')?.value || '(sans objet)'
          const from = headers.find((h: { name: string; value: string }) => h.name === 'From')?.value || ''
          const date = headers.find((h: { name: string; value: string }) => h.name === 'Date')?.value || ''

          // Find PDF attachments
          const attachments: { filename: string; size: number; attachmentId: string }[] = []

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          function findPdfAttachments(parts: any[] | undefined) {
            if (!parts) return
            for (const part of parts) {
              if (
                part.filename &&
                part.filename.toLowerCase().endsWith('.pdf') &&
                part.body?.attachmentId
              ) {
                attachments.push({
                  filename: part.filename,
                  size: part.body.size || 0,
                  attachmentId: part.body.attachmentId,
                })
              }
              if (part.parts) findPdfAttachments(part.parts)
            }
          }

          findPdfAttachments(detail.payload?.parts)

          // Check top-level
          if (
            detail.payload?.filename &&
            detail.payload.filename.toLowerCase().endsWith('.pdf') &&
            detail.payload.body?.attachmentId
          ) {
            attachments.push({
              filename: detail.payload.filename,
              size: detail.payload.body.size || 0,
              attachmentId: detail.payload.body.attachmentId,
            })
          }

          if (attachments.length === 0) return null

          // Filter: only keep if at least one attachment looks like an invoice
          const hasInvoiceAttachment = attachments.some((att) =>
            isLikelyInvoice(subject, from, att.filename)
          )
          if (!hasInvoiceAttachment) return null

          // Only keep invoice-looking attachments (filter out CV.pdf etc in the same email)
          const invoiceAttachments = attachments.filter((att) =>
            isLikelyInvoice(subject, from, att.filename)
          )

          return {
            messageId: msg.id,
            subject,
            from,
            date,
            attachments: invoiceAttachments,
          }
        } catch (err) {
          console.error('Error fetching message:', msg.id, err)
          return null
        }
      })
    )

    const validEmails = emails.filter(Boolean)

    return NextResponse.json({
      emails: validEmails,
      total: validEmails.length,
    })
  } catch (error) {
    console.error('Gmail scan error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    if (message.includes('invalid_grant') || message.includes('Token has been expired')) {
      return NextResponse.json(
        { error: 'Session Gmail expiree. Veuillez vous reconnecter.', reconnect: true },
        { status: 401 }
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
