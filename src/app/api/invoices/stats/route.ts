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

    const snap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()

    const stats = {
      total: 0,
      pending: 0,
      processing: 0,
      classified: 0,
      validated: 0,
      exported: 0,
      error: 0,
    }

    const allDocs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[]

    allDocs.forEach((data) => {
      stats.total++
      const status = data.status as keyof typeof stats
      if (status in stats && status !== 'total') {
        stats[status]++
      }
    })

    // Recent invoices (sort in JS)
    const recent = allDocs
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 5)

    return NextResponse.json({ stats, recent })
  } catch (error) {
    console.error('Stats error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
