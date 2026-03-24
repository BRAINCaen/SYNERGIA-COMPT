import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import anthropic, { FAST_MODEL } from '@/lib/anthropic'

export const dynamic = 'force-dynamic'

// Ultra-lightweight: receives plain text, calls Claude Haiku, returns JSON
// No file upload, no PDF parsing, no Firebase — just text in, JSON out
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

    // Send the text chunk (client handles splitting if needed)
    const chunk = text.substring(0, 30000) // Allow bigger chunks

    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 16384,
      messages: [{
        role: 'user',
        content: `Extrais TOUTES les transactions de ce relevé bancaire. Il peut y avoir beaucoup de transactions sur plusieurs pages.
Réponds UNIQUEMENT en JSON: [{"date":"YYYY-MM-DD","label":"libellé simplifié","debit":nombre_ou_null,"credit":nombre_ou_null}]
Règles:
- Dates JJ/MM/AAAA → YYYY-MM-DD
- Montants en nombres (pas de €, pas d'espaces). Utilise le point comme séparateur décimal.
- Exclure: soldes, totaux, en-têtes, pieds de page
- Pour les labels: garder UNIQUEMENT la première ligne descriptive (pas les références ICS/RUM/numéros de compte)
- REMCB = remise carte bancaire (crédit), COMCB = commission carte (débit), PRLV = prélèvement (débit), VIR = virement

TEXTE DU RELEVÉ:
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
