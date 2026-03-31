export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const appUrl = process.env.NEXT_PUBLIC_APP_URL

    if (!clientId || !clientSecret || !appUrl) {
      return NextResponse.json(
        { error: `Configuration Google OAuth manquante: CLIENT_ID=${!!clientId} SECRET=${!!clientSecret} URL=${!!appUrl}` },
        { status: 500 }
      )
    }

    // Encode user_id in state parameter so callback can link tokens to user
    const state = Buffer.from(JSON.stringify({ uid: decoded.uid })).toString('base64url')

    // Build OAuth URL manually (no googleapis dependency needed)
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', `${appUrl}/api/gmail/callback`)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly')
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.searchParams.set('state', state)

    return NextResponse.json({ url: authUrl.toString() })
  } catch (error) {
    console.error('Gmail auth error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
