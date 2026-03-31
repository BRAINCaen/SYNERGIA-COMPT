export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      console.error('Google OAuth error:', error)
      return NextResponse.redirect(`${appUrl}/gmail?error=oauth_denied&detail=${encodeURIComponent(error)}`)
    }

    if (!code || !state) {
      return NextResponse.redirect(`${appUrl}/gmail?error=missing_params&detail=${encodeURIComponent(`code=${!!code} state=${!!state}`)}`)
    }

    // Decode user_id from state
    let uid: string
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
      uid = decoded.uid
      if (!uid) throw new Error('No uid in state')
    } catch (stateErr) {
      const msg = stateErr instanceof Error ? stateErr.message : 'parse_failed'
      return NextResponse.redirect(`${appUrl}/gmail?error=invalid_state&detail=${encodeURIComponent(msg)}`)
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${appUrl}/gmail?error=config_missing&detail=${encodeURIComponent(`CLIENT_ID=${!!clientId} SECRET=${!!clientSecret}`)}`)
    }

    // Exchange code for tokens via direct fetch (no googleapis needed)
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${appUrl}/api/gmail/callback`,
        grant_type: 'authorization_code',
      }),
    })

    const tokens = await tokenRes.json()

    if (!tokenRes.ok || !tokens.access_token) {
      const detail = tokens.error_description || tokens.error || `status=${tokenRes.status}`
      return NextResponse.redirect(`${appUrl}/gmail?error=no_token&detail=${encodeURIComponent(detail)}`)
    }

    // Get the user's email address
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await profileRes.json()
    const email = profile.emailAddress || null

    // Store tokens in Firestore
    await adminDb.collection('gmailTokens').doc(uid).set({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expiry_date: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope || '',
      email,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    return NextResponse.redirect(`${appUrl}/gmail?gmail=connected`)
  } catch (error) {
    console.error('Gmail callback error:', error instanceof Error ? error.message : error)
    const errMsg = encodeURIComponent(error instanceof Error ? error.message : 'unknown')
    return NextResponse.redirect(`${appUrl}/gmail?error=callback_failed&detail=${errMsg}`)
  }
}
