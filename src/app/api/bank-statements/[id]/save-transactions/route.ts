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

    // Deterministic debit/credit corrector — overrides AI errors
    // Returns 'debit' | 'credit' | null (null = trust AI)
    const forceTypeFromLabel = (label: string): 'debit' | 'credit' | null => {
      const u = (label || '').toUpperCase()
      // Forced CREDIT (recettes)
      if (/^REMCB|REMISE CHEQUE|REMISE TICKET|REMISE ANCV/.test(u)) return 'credit'
      if (/VIR PAYPAL|VIR SEPA PAYPAL/.test(u)) return 'credit'
      if (/VIR (SEPA )?(INST )?(EDENRED|CAP LOISIRS|LUDOBOX|FUNBOOKER|ASP |DRFIP|EUROFEU|ORANGE|SOCOTEC)/.test(u)) return 'credit'
      // Forced DEBIT (depenses)
      if (/^PRLV |^PAIEMENT CB|^FRAIS |^COMCB|^ECH PRET|^INTERETS|FACT SGT|PLAN SANTE|TNS PREVOYANCE|COMPLEMENTAIRE SANTE|AUTOMOBILE PRO/.test(u)) return 'debit'
      if (/^VIR (SEPA |INST )?ACOMPTE|^VIR (SEPA |INST )?SALAIRE|^VIR (SEPA )?LOYER|^VIR (SEPA )?FORFAIT|^VIR (SEPA )?INDEMNITES/.test(u)) return 'debit'
      if (/VIR (SEPA )?BOEHME ALLAN|VIR (SEPA )?ALLAN BOEHME/.test(u)) return 'debit'
      return null
    }

    // Normalize label for dedup fingerprinting (strip variable refs/IDs)
    const normalizeLabel = (s: string) =>
      (s || '').toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\b(REF|NUM|ID|RUM|VU\d+|CU\d+|SCT\w+)\s*\S*/gi, '')
        .replace(/\d{8,}/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40)

    // Fetch existing transactions for this statement to skip duplicates on re-parse
    const existingSnap = await adminDb
      .collection('bankTransactions')
      .where('statement_id', '==', params.id)
      .get()
    const existingFingerprints = new Set<string>()
    for (const d of existingSnap.docs) {
      const data = d.data()
      const date = (data.date || '').toString().slice(0, 10)
      const amt = data.amount != null ? Number(data.amount).toFixed(2) : ''
      const lbl = normalizeLabel(data.label || '')
      existingFingerprints.add(`${date}|${data.type}|${amt}|${lbl}`)
    }

    let totalDebits = 0
    let totalCredits = 0
    let ignoredCount = 0
    let forcedCount = 0
    let skippedDupCount = 0
    const insertedFingerprints = new Set<string>()

    // Write in batches of 490
    for (let i = 0; i < transactions.length; i += 490) {
      const chunk = transactions.slice(i, i + 490)
      const batch = adminDb.batch()
      let batchHasWrites = false

      for (const t of chunk) {
        // Determine type (AI hint vs forced rule)
        let isDebit = t.debit != null && t.debit > 0
        const forced = forceTypeFromLabel(t.label)
        if (forced && (forced === 'debit') !== isDebit) {
          isDebit = forced === 'debit'
          forcedCount++
        }
        const amount = Math.abs(t.debit ?? t.credit ?? 0)
        if (amount === 0) continue

        // Dedup fingerprint
        const dateKey = (t.date || '').toString().slice(0, 10)
        const fp = `${dateKey}|${isDebit ? 'debit' : 'credit'}|${amount.toFixed(2)}|${normalizeLabel(t.label)}`
        if (existingFingerprints.has(fp) || insertedFingerprints.has(fp)) {
          skippedDupCount++
          continue
        }
        insertedFingerprints.add(fp)

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
        batchHasWrites = true
      }

      if (batchHasWrites) await batch.commit()
    }

    const insertedCount = insertedFingerprints.size

    // Add existing transactions to totals (we kept them, just deduped)
    let existingDebits = 0
    let existingCredits = 0
    for (const d of existingSnap.docs) {
      const data = d.data()
      const amt = Number(data.amount) || 0
      if (data.type === 'debit') existingDebits += amt
      else existingCredits += amt
    }
    const finalDebits = Math.round((existingDebits + totalDebits) * 100) / 100
    const finalCredits = Math.round((existingCredits + totalCredits) * 100) / 100
    const finalCount = existingSnap.size + insertedCount

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
      transaction_count: finalCount,
      total_debits: finalDebits,
      total_credits: finalCredits,
      period_month: periodMonth || null,
      updated_at: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      transaction_count: finalCount,
      inserted_count: insertedCount,
      skipped_duplicates: skippedDupCount,
      type_corrections: forcedCount,
      total_debits: finalDebits,
      total_credits: finalCredits,
      period_month: periodMonth,
      ignored_count: ignoredCount,
    })
  } catch (error) {
    console.error('Save transactions error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
