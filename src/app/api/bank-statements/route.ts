import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const snap = await adminDb
      .collection('bankStatements')
      .where('user_id', '==', decoded.uid)
      .orderBy('created_at', 'desc')
      .get()

    const statements = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

    return NextResponse.json({ statements })
  } catch (error) {
    console.error('GET bank-statements error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
