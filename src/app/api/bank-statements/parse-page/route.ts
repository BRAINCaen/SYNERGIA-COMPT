import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import anthropic, { FAST_MODEL } from '@/lib/anthropic'

export const dynamic = 'force-dynamic'

// Receives a single PDF page as base64 IMAGE, returns transactions
// Claude Vision sees the actual column layout → perfect debit/credit
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { image, pageNum, totalPages } = await request.json()
    if (!image) {
      return NextResponse.json({ transactions: [] })
    }

    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: image },
          },
          {
            type: 'text',
            text: `Page ${pageNum}/${totalPages} d'un relevé bancaire Crédit Mutuel.

Extrais TOUTES les transactions visibles dans le tableau. Chaque transaction a :
- Date (colonne "Date")
- Date valeur (colonne "Date valeur")
- Libellé (colonne "Opération" - première ligne seulement, pas les détails ICS/RUM)
- Montant dans la colonne "Débit EUROS" OU "Crédit EUROS"

REGLE ABSOLUE pour debit/credit : regarde VISUELLEMENT dans quelle colonne le montant se trouve
- Colonne "Débit EUROS" (avant-dernière colonne) = debit (mets le montant dans debit, credit=null)
- Colonne "Crédit EUROS" (dernière colonne) = credit (mets le montant dans credit, debit=null)
- Si tu hésites, applique ces règles métier strictes :
  * REMCB / REMISE CHEQUE / REMISE TICKETS = TOUJOURS credit
  * VIR PAYPAL PTE LTD = TOUJOURS credit (encaissements iZettle)
  * VIR EDENRED / CAP LOISIRS / LUDOBOX / FUNBOOKER / ASP / DRFIP = TOUJOURS credit
  * PRLV SEPA / PAIEMENT CB / FRAIS / COMCB / ECH PRET / INTERETS = TOUJOURS debit
  * VIR SEPA ACOMPTE / SALAIRE / LOYER / FORFAIT = TOUJOURS debit (versement vers tiers)
  * VIR BOEHME ALLAN = debit (gérant qui retire)
- Ne JAMAIS extraire la même ligne deux fois (une fois en debit, une fois en credit) : c'est forcément une erreur

Exclure : SOLDE CREDITEUR, SOLDE DEBITEUR, Total des mouvements, Report, en-têtes de colonne, pieds de page.

Réponds UNIQUEMENT en JSON :
[{"date":"DD/MM/YYYY","date_valeur":"DD/MM/YYYY","label":"libellé","debit":nombre_ou_null,"credit":nombre_ou_null}]
Montants en nombres avec point décimal (1234.56). Jamais de symbole €, jamais d'espace dans les nombres.`
          }
        ],
      }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ transactions: [] })
    }

    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    try {
      const transactions = JSON.parse(jsonText)
      return NextResponse.json({ transactions })
    } catch {
      return NextResponse.json({ transactions: [] })
    }
  } catch (error) {
    console.error('Parse page error:', error)
    return NextResponse.json({ transactions: [] })
  }
}
