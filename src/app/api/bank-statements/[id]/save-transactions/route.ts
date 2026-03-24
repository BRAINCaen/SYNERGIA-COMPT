import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { transactions } = await request.json()
    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json({ error: 'Pas de transactions' }, { status: 400 })
    }

    // Fetch ignore rules for user
    const ignoreRulesSnap = await adminDb
      .collection('ignoreRules')
      .where('user_id', '==', decoded.uid)
      .get()
    const ignoreRules = ignoreRulesSnap.docs.map((d) => d.data() as {
      pattern: string
      match_type: 'contains' | 'starts_with' | 'exact'
    })

    const matchesIgnoreRule = (label: string): boolean => {
      const upper = (label || '').toUpperCase()
      return ignoreRules.some((rule) => {
        const pat = rule.pattern.toUpperCase()
        switch (rule.match_type) {
          case 'exact':
            return upper === pat
          case 'starts_with':
            return upper.startsWith(pat)
          case 'contains':
            return upper.includes(pat)
          default:
            return false
        }
      })
    }

    let totalDebits = 0
    let totalCredits = 0
    let ignoredCount = 0

    // Write in batches of 490
    for (let i = 0; i < transactions.length; i += 490) {
      const chunk = transactions.slice(i, i + 490)
      const batch = adminDb.batch()

      for (const t of chunk) {
        const isDebit = t.debit != null && t.debit > 0
        const amount = isDebit ? Math.abs(t.debit) : Math.abs(t.credit || 0)

        if (isDebit) totalDebits += amount
        else totalCredits += amount

        const shouldIgnore = matchesIgnoreRule(t.label)
        if (shouldIgnore) ignoredCount++

        const ref = adminDb.collection('bankTransactions').doc()
        batch.set(ref, {
          id: ref.id,
          statement_id: params.id,
          user_id: decoded.uid,
          date: t.date,
          label: t.label,
          amount,
          type: isDebit ? 'debit' : 'credit',
          match_status: shouldIgnore ? 'ignored' : 'unmatched',
          matched_invoice_id: null,
          created_at: new Date().toISOString(),
        })
      }

      await batch.commit()
    }

    // Compute period month
    const months: Record<string, number> = {}
    for (const t of transactions) {
      if (t.date) {
        const ym = t.date.substring(0, 7)
        months[ym] = (months[ym] || 0) + 1
      }
    }
    let periodMonth = ''
    let bestCount = 0
    for (const [ym, count] of Object.entries(months)) {
      if (count > bestCount) { periodMonth = ym; bestCount = count }
    }

    // Update statement
    await adminDb.collection('bankStatements').doc(params.id).update({
      status: 'parsed',
      transaction_count: transactions.length,
      total_debits: Math.round(totalDebits * 100) / 100,
      total_credits: Math.round(totalCredits * 100) / 100,
      period_month: periodMonth || null,
      updated_at: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      transaction_count: transactions.length,
      total_debits: Math.round(totalDebits * 100) / 100,
      total_credits: Math.round(totalCredits * 100) / 100,
      period_month: periodMonth,
      ignored_count: ignoredCount,
    })
  } catch (error) {
    console.error('Save transactions error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
