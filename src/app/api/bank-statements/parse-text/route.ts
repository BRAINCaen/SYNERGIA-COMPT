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

    // Only send the first 5000 chars (one page is typically 1000-3000 chars)
    const pageText = text.substring(0, 5000)

    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Extrais les transactions de CETTE PAGE d'un relevé bancaire Crédit Mutuel.

FORMAT DU RELEVÉ : chaque transaction a une date, une date valeur, un libellé, et un montant dans la colonne "Débit EUROS" OU "Crédit EUROS".

RÈGLES ABSOLUES :
- Débit = argent qui SORT du compte (PRLV, PAIEMENT CB, VIR sortants salaires/loyer, COMCB, FRAIS, INTERETS/FRAIS, ECH PRET, cotisations)
- Crédit = argent qui ENTRE dans le compte (REMCB = encaissements TPE, VIR PAYPAL PTE LTD, VIR entrants de tiers)
- Un PRLV SEPA est TOUJOURS un débit
- Un PAIEMENT CB est TOUJOURS un débit
- Un REMCB est TOUJOURS un crédit
- Un COMCB est un débit SAUF s'il est dans la colonne Crédit (rare, petits montants < 1€)
- VIR SEPA ACOMPTE/SALAIRE/LOYER/FORFAIT/INDEMNITES ALLAN = débit
- VIR INST SOLDE SALAIRE = débit
- VIR PAYPAL PTE. LTD. = crédit
- VIR ASP/DRFIP/EDENRED/CAP LOISIRS/LUDOBOX/FUNBOOKER/SOCOTEC/EUROFEU/ORANGE = crédit
- VIR BOEHME ALLAN = débit (le gérant retire de l'argent)
- INTERETS/FRAIS, FACT SGT, PLAN SANTE, TNS PREVOYANCE, COMPLEMENTAIRE SANTE, AUTOMOBILE PRO = débit

Exclure : SOLDE CREDITEUR, Total des mouvements, en-têtes de page, pieds de page.

Réponds UNIQUEMENT en JSON valide :
[{"date":"YYYY-MM-DD","label":"libellé court (1ère ligne seulement)","debit":nombre_ou_null,"credit":nombre_ou_null}]

Montants : nombres avec point décimal (1234.56), pas de €.

TEXTE DE LA PAGE :
${pageText}`
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
    console.error('Parse text error:', error)
    return NextResponse.json({ transactions: [] })
  }
}
