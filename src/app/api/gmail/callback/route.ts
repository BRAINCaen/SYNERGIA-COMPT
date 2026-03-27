export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { adminDb } from '@/lib/firebase/admin'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

    if (error) {
      console.error('Google OAuth error:', error)
      return NextResponse.redirect(`${appUrl}/gmail?error=oauth_denied`)
    }

    if (!code || !state) {
      return NextResponse.redirect(`${appUrl}/gmail?error=missing_params`)
    }

    // Decode user_id from state
    let uid: string
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
      uid = decoded.uid
      if (!uid) throw new Error('No uid in state')
    } catch {
      return NextResponse.redirect(`${appUrl}/gmail?error=invalid_state`)
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${appUrl}/gmail?error=config_missing`)
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${appUrl}/api/gmail/callback`
    )

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code)

    if (!tokens.access_token) {
      return NextResponse.redirect(`${appUrl}/gmail?error=no_token`)
    }

    // Get the user's email address
    oauth2Client.setCredentials(tokens)
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    const profile = await gmail.users.getProfile({ userId: 'me' })
    const email = profile.data.emailAddress || null

    // Store tokens in Firestore
    await adminDb.collection('gmailTokens').doc(uid).set({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expiry_date: tokens.expiry_date || null,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope || '',
      email,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    return NextResponse.redirect(`${appUrl}/gmail?gmail=connected`)
  } catch (error) {
    console.error('Gmail callback error:', error instanceof Error ? error.message : error, error instanceof Error ? error.stack : '')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const errMsg = encodeURIComponent(error instanceof Error ? error.message : 'unknown')
    return NextResponse.redirect(`${appUrl}/gmail?error=callback_failed&detail=${errMsg}`)
  }
}
