import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import anthropic, { FAST_MODEL } from '@/lib/anthropic'
import { ParsedTransaction } from '@/lib/bank-parsers'
import { forceTypeFromLabel, normalizeLabel } from '@/lib/bank-tx-validator'

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
            text: `Extrais TOUTES les transactions de ce releve bancaire Credit Mutuel en JSON.

Pour chaque ligne : date (YYYY-MM-DD), value_date (YYYY-MM-DD ou null), label (libelle COMPLET avec marchand/tiers, voir regle), reference (null si absent), debit (nombre ou null), credit (nombre ou null).

REGLE LIBELLE (TRES IMPORTANT) :
- Garde TOUT le texte utile : nom commercant, type operation, beneficiaire/payeur
- PAIEMENT CB XXXX -> inclus le marchand qui suit (ex "PAIEMENT CB 0604 UBER EATS")
- VIR / PRLV -> inclus le tiers (ex "VIR SEPA EDF FRANCE", "PRLV SEPA URSSAF")
- REMCB -> inclus numero de bordereau et detail si visible
- Si libelle sur 2-3 lignes dans le PDF, CONCATENE en gardant le marchand
- Ignore uniquement : ICS XXXXX, RUM XXXX, SCT XXXX, references techniques longues
- Max 80 caracteres mais le marchand est prioritaire

REGLE ABSOLUE debit/credit : regarde VISUELLEMENT dans quelle colonne le montant se trouve
- Colonne "Debit EUROS" = debit (debit=nombre, credit=null)
- Colonne "Credit EUROS" = credit (credit=nombre, debit=null)
- Une transaction n'a JAMAIS les deux remplis ni les deux nuls
- Ne JAMAIS extraire la meme ligne deux fois (une en debit, une en credit) : c'est une erreur

Regles metier strictes (a appliquer si tu hesites) :
- REMCB / REMISE CHEQUE / REMISE TICKET = TOUJOURS credit
- VIR PAYPAL PTE LTD = TOUJOURS credit (encaissements iZettle)
- VIR EDENRED / CAP LOISIRS / LUDOBOX / FUNBOOKER / ASP / DRFIP = TOUJOURS credit
- PRLV SEPA / PAIEMENT CB / FRAIS / COMCB / ECH PRET / INTERETS = TOUJOURS debit
- VIR SEPA ACOMPTE / SALAIRE / LOYER / FORFAIT / INDEMNITES = TOUJOURS debit
- VIR BOEHME ALLAN = debit (gerant qui retire)

Dates JJ/MM/AAAA -> YYYY-MM-DD. Montants en nombres avec point decimal (1234.56), sans symbole, sans espace.
Exclure : SOLDE CREDITEUR, SOLDE DEBITEUR, Total mouvements, Report, en-tetes, pieds de page.

Reponds UNIQUEMENT avec le JSON: [{"date":"2026-01-15","value_date":null,"label":"PRLV SEPA EDF","reference":null,"debit":85.50,"credit":null}]`
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

    // Existing transactions for dedup
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
    const insertedFingerprints = new Set<string>()

    // Write transactions in batches
    let totalDebits = 0
    let totalCredits = 0
    let forcedCount = 0
    let skippedDupCount = 0

    for (let i = 0; i < parsed.length; i += 490) {
      const chunk = parsed.slice(i, i + 490)
      const batch = adminDb.batch()
      let batchHasWrites = false

      for (const t of chunk) {
        let isDebit = t.debit != null && t.debit > 0
        const forced = forceTypeFromLabel(t.label || '')
        if (forced && (forced === 'debit') !== isDebit) {
          isDebit = forced === 'debit'
          forcedCount++
        }
        const amount = Math.abs(t.debit ?? t.credit ?? 0)
        if (amount === 0) continue

        const dateKey = (t.date || '').toString().slice(0, 10)
        const fp = `${dateKey}|${isDebit ? 'debit' : 'credit'}|${amount.toFixed(2)}|${normalizeLabel(t.label || '')}`
        if (existingFingerprints.has(fp) || insertedFingerprints.has(fp)) {
          skippedDupCount++
          continue
        }
        insertedFingerprints.add(fp)

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
        batchHasWrites = true
      }

      if (batchHasWrites) await batch.commit()
    }
    const insertedCount = insertedFingerprints.size

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

    // Include existing transactions in totals
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
      type_corrections: forcedCount,
      skipped_duplicates: skippedDupCount,
      total_debits: finalDebits,
      total_credits: finalCredits,
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
