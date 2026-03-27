import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const doc = await adminDb.collection('gmailTokens').doc(decoded.uid).get()

    if (!doc.exists) {
      return NextResponse.json({ connected: false, email: null })
    }

    const data = doc.data()
    return NextResponse.json({
      connected: true,
      email: data?.email || null,
    })
  } catch (error) {
    console.error('Gmail status error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
