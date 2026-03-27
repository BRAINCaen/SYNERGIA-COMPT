import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

function getGmailClient(tokens: {
  access_token: string
  refresh_token?: string | null
  expiry_date?: number | null
}) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${appUrl}/api/gmail/callback`
  )

  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || undefined,
    expiry_date: tokens.expiry_date || undefined,
  })

  // Auto-refresh token handler
  oauth2Client.on('tokens', async (newTokens) => {
    // Tokens will be updated in Firestore if refreshed
    // This is handled per-request below
    console.log('Gmail tokens refreshed')
    if (newTokens.access_token) {
      tokens.access_token = newTokens.access_token
    }
  })

  return { oauth2Client, gmail: google.gmail({ version: 'v1', auth: oauth2Client }) }
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const body = await request.json()
    const { days = 30, sender } = body

    // Get stored tokens
    const tokenDoc = await adminDb.collection('gmailTokens').doc(decoded.uid).get()
    if (!tokenDoc.exists) {
      return NextResponse.json({ error: 'Gmail non connecte' }, { status: 400 })
    }

    const tokenData = tokenDoc.data() as { access_token: string; refresh_token?: string | null; expiry_date?: number | null }
    const { gmail, oauth2Client } = getGmailClient(tokenData)

    // Build search query
    let query = `has:attachment filename:pdf newer_than:${days}d`
    if (sender) {
      query += ` from:${sender}`
    }

    // Search for matching messages
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50,
    })

    const messageIds = listRes.data.messages || []

    if (messageIds.length === 0) {
      return NextResponse.json({ emails: [], total: 0 })
    }

    // Fetch details for each message (headers only, no body content)
    const emails = await Promise.all(
      messageIds.map(async (msg) => {
        try {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date'],
          })

          const headers = detail.data.payload?.headers || []
          const subject = headers.find((h) => h.name === 'Subject')?.value || '(sans objet)'
          const from = headers.find((h) => h.name === 'From')?.value || ''
          const date = headers.find((h) => h.name === 'Date')?.value || ''

          // Get attachment info from parts
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
              // Recurse into nested parts (multipart messages)
              if (part.parts) {
                findPdfAttachments(part.parts)
              }
            }
          }

          // We need full message to see parts - re-fetch with FULL format just for parts structure
          const fullDetail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'full',
            // Only need structure, not body data
          })

          findPdfAttachments(fullDetail.data.payload?.parts)

          // Also check top-level payload (single-part messages)
          if (
            fullDetail.data.payload?.filename &&
            fullDetail.data.payload.filename.toLowerCase().endsWith('.pdf') &&
            fullDetail.data.payload.body?.attachmentId
          ) {
            attachments.push({
              filename: fullDetail.data.payload.filename,
              size: fullDetail.data.payload.body.size || 0,
              attachmentId: fullDetail.data.payload.body.attachmentId,
            })
          }

          if (attachments.length === 0) return null

          return {
            messageId: msg.id,
            subject,
            from,
            date,
            attachments,
          }
        } catch (err) {
          console.error('Error fetching message:', msg.id, err)
          return null
        }
      })
    )

    // Filter out nulls (messages where we couldn't find PDF attachments)
    const validEmails = emails.filter(Boolean)

    // Update tokens if refreshed
    const credentials = oauth2Client.credentials
    if (credentials.access_token && credentials.access_token !== tokenData.access_token) {
      await adminDb.collection('gmailTokens').doc(decoded.uid).update({
        access_token: credentials.access_token,
        expiry_date: credentials.expiry_date || null,
        updated_at: new Date().toISOString(),
      })
    }

    return NextResponse.json({
      emails: validEmails,
      total: validEmails.length,
    })
  } catch (error) {
    console.error('Gmail scan error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    // Check for auth errors
    if (message.includes('invalid_grant') || message.includes('Token has been expired')) {
      return NextResponse.json(
        { error: 'Session Gmail expiree. Veuillez vous reconnecter.', reconnect: true },
        { status: 401 }
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
