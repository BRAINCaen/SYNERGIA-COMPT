import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import anthropic, { FAST_MODEL } from '@/lib/anthropic'
import { ParsedTransaction } from '@/lib/bank-parsers'

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

    const statementDoc = await adminDb.collection('bankStatements').doc(params.id).get()
    if (!statementDoc.exists) {
      return NextResponse.json({ error: 'Relevé non trouvé' }, { status: 404 })
    }

    const statement = statementDoc.data()!

    // Download PDF from Firebase Storage
    const bucket = adminStorage.bucket()
    const fileRef = bucket.file(statement.file_path)
    const [fileBuffer] = await fileRef.download()
    const base64Pdf = fileBuffer.toString('base64')

    // Use Claude to extract transactions
    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
          },
          {
            type: 'text',
            text: `Extrais TOUTES les transactions de ce relevé bancaire en JSON.
Pour chaque ligne: date (YYYY-MM-DD), value_date (YYYY-MM-DD ou null), label (libellé complet), reference (null si absent), debit (nombre ou null), credit (nombre ou null).
Dates JJ/MM/AAAA → YYYY-MM-DD. Montants en nombres sans €. Exclure les soldes.
Réponds UNIQUEMENT avec le JSON: [{"date":"2026-01-15","value_date":null,"label":"PRLV SEPA EDF","reference":null,"debit":85.50,"credit":null}]`
          }
        ],
      }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'Pas de réponse IA' }, { status: 500 })
    }

    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const parsed: ParsedTransaction[] = JSON.parse(jsonText)

    if (parsed.length === 0) {
      await adminDb.collection('bankStatements').doc(params.id).update({
        status: 'error',
        error_message: 'Aucune transaction trouvée',
        updated_at: new Date().toISOString(),
      })
      return NextResponse.json({ success: false, error: 'Aucune transaction trouvée' })
    }

    // Write transactions in batches
    let totalDebits = 0
    let totalCredits = 0

    for (let i = 0; i < parsed.length; i += 490) {
      const chunk = parsed.slice(i, i + 490)
      const batch = adminDb.batch()

      for (const t of chunk) {
        const isDebit = t.debit != null && t.debit > 0
        const amount = isDebit ? Math.abs(t.debit!) : Math.abs(t.credit!)

        if (isDebit) totalDebits += amount
        else totalCredits += amount

        const ref = adminDb.collection('bankTransactions').doc()
        batch.set(ref, {
          id: ref.id,
          statement_id: params.id,
          user_id: decoded.uid,
          date: t.date,
          value_date: t.value_date,
          label: t.label,
          reference: t.reference,
          amount,
          type: isDebit ? 'debit' : 'credit',
          match_status: 'unmatched',
          matched_invoice_id: null,
          matched_revenue_id: null,
          created_at: new Date().toISOString(),
        })
      }

      await batch.commit()
    }

    // Compute period month
    const months: Record<string, number> = {}
    for (const t of parsed) {
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

    await adminDb.collection('bankStatements').doc(params.id).update({
      status: 'parsed',
      transaction_count: parsed.length,
      total_debits: Math.round(totalDebits * 100) / 100,
      total_credits: Math.round(totalCredits * 100) / 100,
      period_month: periodMonth || null,
      updated_at: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      transaction_count: parsed.length,
      total_debits: Math.round(totalDebits * 100) / 100,
      total_credits: Math.round(totalCredits * 100) / 100,
    })
  } catch (error) {
    console.error('Analyze bank statement error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    await adminDb.collection('bankStatements').doc(params.id).update({
      status: 'error',
      error_message: message,
      updated_at: new Date().toISOString(),
    }).catch(() => {})
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
