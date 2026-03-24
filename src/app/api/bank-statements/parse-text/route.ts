import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import anthropic, { FAST_MODEL } from '@/lib/anthropic'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { text } = await request.json()
    if (!text || text.length < 30) {
      return NextResponse.json({ error: 'Texte trop court' }, { status: 400 })
    }

    const chunk = text.substring(0, 14000)

    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `Tu extrais les transactions d'un relevé bancaire Crédit Mutuel (format français).

RÈGLES CRITIQUES pour débit/crédit :
- La colonne "Débit EUROS" = argent qui SORT du compte (débit > 0, credit = null)
- La colonne "Crédit EUROS" = argent qui ENTRE dans le compte (debit = null, credit > 0)

DÉBITS (argent sortant) :
- VIR SEPA ACOMPTE/SALAIRE/LOYER = débit (on paie les salariés/loyer)
- PRLV SEPA = prélèvement = débit (on nous prélève)
- PAIEMENT CB = débit (on paie par carte)
- COMCB = commission carte bancaire = débit
- FRAIS PAIE CB = frais = débit
- ECH PRET = échéance de prêt = débit
- VIR SEPA INDEMNITES = débit (on verse des indemnités)
- INTERETS/FRAIS = débit (frais bancaires)
- VIR BOEHME ALLAN = débit (virement sortant du gérant)
- VIR INST SOLDE SALAIRE = débit (on paie les salaires)
- VIR INST EUROFEU = débit (on paie un fournisseur)
- FACT SGT = débit (facturation de services bancaires)
- PLAN SANTE / TNS PREVOYANCE / COMPLEMENTAIRE SANTE / AUTOMOBILE PRO = débit (cotisations)

CRÉDITS (argent entrant) :
- REMCB = remise carte bancaire = crédit (encaissement TPE clients)
- VIR PAYPAL PTE. LTD. = crédit (PayPal nous verse de l'argent)
- VIR ASP AGENCE COMPTABLE = crédit (subvention/aide)
- VIR DRFIP / VIR EDENRED / VIR SOCOTEC / VIR CAP LOISIRS / VIR LUDOBOX / VIR INST FUNBOOKER = crédit (on reçoit un paiement)
- VIR ORANGE (remboursement) = crédit

Réponds UNIQUEMENT en JSON: [{"date":"YYYY-MM-DD","label":"libellé court","debit":nombre_ou_null,"credit":nombre_ou_null}]
- Dates DD/MM/YYYY → YYYY-MM-DD. Montants en nombres avec point décimal.
- Exclure soldes, totaux, en-têtes. Garder uniquement la 1ère ligne du libellé.

TEXTE:
${chunk}`
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

    const transactions = JSON.parse(jsonText)
    return NextResponse.json({ transactions })
  } catch (error) {
    console.error('Parse text error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur' }, { status: 500 })
  }
}
