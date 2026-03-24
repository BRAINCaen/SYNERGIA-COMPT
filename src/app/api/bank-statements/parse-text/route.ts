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

    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `Extrais les transactions de ce relevé bancaire.
Réponds UNIQUEMENT en JSON: [{"date":"YYYY-MM-DD","label":"libellé","debit":nombre_ou_null,"credit":nombre_ou_null}]
Règles: dates JJ/MM/AAAA → YYYY-MM-DD. Montants en nombres sans €. Exclure soldes/totaux.

TEXTE:
${text.substring(0, 15000)}`
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
