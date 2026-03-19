import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Get all bank transactions for this user (simple query, no composite index)
    const txSnap = await adminDb
      .collection('bankTransactions')
      .where('user_id', '==', decoded.uid)
      .get()

    if (txSnap.empty) {
      return NextResponse.json({ alerts: [] })
    }

    // Group transactions by month
    const byMonth: Record<string, { total: number; unmatched_debits: number; unmatched_credits: number }> = {}
    for (const doc of txSnap.docs) {
      const t = doc.data()
      const month = (t.date || '').substring(0, 7)
      if (!month) continue
      if (!byMonth[month]) byMonth[month] = { total: 0, unmatched_debits: 0, unmatched_credits: 0 }
      byMonth[month].total++
      if (t.match_status === 'unmatched') {
        if (t.type === 'debit') byMonth[month].unmatched_debits++
        else byMonth[month].unmatched_credits++
      }
    }

    const alerts = Object.entries(byMonth).map(([month, data]) => {
      const totalUnmatched = data.unmatched_debits + data.unmatched_credits
      return {
        month,
        total_transactions: data.total,
        unmatched_debits: data.unmatched_debits,
        unmatched_credits: data.unmatched_credits,
        missing_invoices: 0,
        reconciliation_rate: data.total > 0 ? Math.round(((data.total - totalUnmatched) / data.total) * 100) : 0,
        is_dismissed: false,
      }
    }).sort((a, b) => b.month.localeCompare(a.month))

    return NextResponse.json({ alerts })
  } catch (error) {
    console.error('GET alerts error:', error)
    return NextResponse.json({ alerts: [] })
  }
}
