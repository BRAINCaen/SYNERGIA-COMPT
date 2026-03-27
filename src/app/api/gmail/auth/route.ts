import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
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
        { error: 'Configuration Google OAuth manquante (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXT_PUBLIC_APP_URL)' },
        { status: 500 }
      )
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${appUrl}/api/gmail/callback`
    )

    // Encode user_id in state parameter so callback can link tokens to user
    const state = Buffer.from(JSON.stringify({ uid: decoded.uid })).toString('base64url')

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/gmail.readonly'],
      state,
    })

    return NextResponse.json({ url })
  } catch (error) {
    console.error('Gmail auth error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
