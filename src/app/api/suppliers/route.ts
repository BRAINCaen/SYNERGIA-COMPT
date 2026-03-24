import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const snap = await adminDb.collection('suppliers').get()
    const suppliers = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => (b.last_used_at || '').localeCompare(a.last_used_at || ''))

    return NextResponse.json(suppliers)
  } catch (error) {
    console.error('GET suppliers error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
