import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

/**
 * Global bank transactions endpoint.
 * GET /api/bank-statements/transactions?match_status=unmatched&month=YYYY-MM
 * Returns transactions across all statements for the authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const matchStatus = searchParams.get('match_status')
    const month = searchParams.get('month')
    const type = searchParams.get('type')

    const snap = await adminDb
      .collection('bankTransactions')
      .where('user_id', '==', decoded.uid)
      .get()

    let transactions = snap.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data(),
    })) as any[]

    if (matchStatus) {
      transactions = transactions.filter((t) => t.match_status === matchStatus)
    }
    if (month) {
      transactions = transactions.filter((t) => (t.date || '').startsWith(month))
    }
    if (type) {
      transactions = transactions.filter((t) => t.type === type)
    }

    transactions.sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))

    return NextResponse.json({ transactions })
  } catch (error) {
    console.error('GET global transactions error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
