export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    // Simple query by user_id, sort in JS (avoid composite index)
    const snap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()

    let invoices = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

    // Filter by status
    if (status && status !== 'all') {
      invoices = invoices.filter((inv: any) => inv.status === status)
    }

    // Sort by created_at desc
    invoices.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))

    return NextResponse.json(invoices)
  } catch (error) {
    console.error('GET invoices error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
