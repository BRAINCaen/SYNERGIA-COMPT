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
      .get()

    // Aggregate per-statement reconciliation stats in a single read
    type StmtStats = { matched: number; ignored: number; total: number }
    const stats = new Map<string, StmtStats>()
    const txSnap = await adminDb
      .collection('bankTransactions')
      .where('user_id', '==', decoded.uid)
      .get()
    for (const d of txSnap.docs) {
      const data = d.data()
      const sid = data.statement_id
      if (!sid) continue
      const s = stats.get(sid) || { matched: 0, ignored: 0, total: 0 }
      s.total++
      if (data.match_status === 'matched') s.matched++
      else if (data.match_status === 'ignored') s.ignored++
      stats.set(sid, s)
    }

    const statements = snap.docs
      .map((doc) => {
        const data = doc.data()
        const s = stats.get(doc.id) || { matched: 0, ignored: 0, total: 0 }
        const treated = s.matched + s.ignored
        const remaining = Math.max(0, s.total - treated)
        const matchPercent = s.total > 0 ? Math.round((treated / s.total) * 100) : 0
        return {
          id: doc.id,
          ...data,
          matched_count: s.matched,
          ignored_count: s.ignored,
          treated_count: treated,
          remaining_count: remaining,
          match_percent: matchPercent,
        }
      })
      .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))

    return NextResponse.json({ statements })
  } catch (error) {
    console.error('GET bank-statements error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
