import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

// Apply auto-match rules to unmatched bank transactions
// Can be called after uploading a document or a bank statement
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await request.json()
    const { statement_id, rule_id } = body // optional: limit to a specific statement or rule

    // Load all active rules for this user
    const rulesSnap = await adminDb
      .collection('autoMatchRules')
      .where('user_id', '==', decoded.uid)
      .get()

    let rules = rulesSnap.docs
      .map(doc => doc.data())
      .filter((r: any) => r.is_active !== false)

    if (rule_id) {
      rules = rules.filter((r: any) => r.id === rule_id)
    }

    if (rules.length === 0) {
      return NextResponse.json({ matched: 0, message: 'Aucune règle active' })
    }

    // Load unmatched transactions
    const txSnap = await adminDb
      .collection('bankTransactions')
      .where('user_id', '==', decoded.uid)
      .get()

    let unmatchedTxs = txSnap.docs
      .filter(doc => doc.data().match_status === 'unmatched')

    if (statement_id) {
      unmatchedTxs = unmatchedTxs.filter(doc => doc.data().statement_id === statement_id)
    }

    let totalMatched = 0
    const matchDetails: { rule: string; count: number }[] = []

    for (const rule of rules) {
      const r = rule as any
      const pattern = (r.pattern || '').toUpperCase()
      if (!pattern) continue

      // Find matching transactions
      const matching = unmatchedTxs.filter(doc => {
        const label = (doc.data().label || '').toUpperCase()
        if (r.match_type === 'starts_with') return label.startsWith(pattern)
        if (r.match_type === 'exact') return label === pattern
        return label.includes(pattern) // default: contains
      })

      if (matching.length === 0) continue

      // Apply in batches
      for (let i = 0; i < matching.length; i += 490) {
        const chunk = matching.slice(i, i + 490)
        const batch = adminDb.batch()
        for (const doc of chunk) {
          const update: Record<string, unknown> = {
            match_status: 'matched',
            match_method: 'auto_rule',
            match_confidence: 0.90,
          }
          if (r.document_type === 'invoice') update.matched_invoice_id = r.document_id
          else if (r.document_type === 'revenue') update.matched_revenue_id = r.document_id
          else update.matched_invoice_id = r.document_id

          batch.update(doc.ref, update)
        }
        await batch.commit()
      }

      // Remove matched from the pool for next rules
      const matchedIds = new Set(matching.map(d => d.id))
      unmatchedTxs = unmatchedTxs.filter(d => !matchedIds.has(d.id))

      totalMatched += matching.length
      matchDetails.push({ rule: r.description || r.pattern, count: matching.length })
    }

    return NextResponse.json({
      success: true,
      matched: totalMatched,
      details: matchDetails,
    })
  } catch (error) {
    console.error('Apply auto-match rules error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
