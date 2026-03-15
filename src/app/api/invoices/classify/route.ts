import { NextRequest, NextResponse } from 'next/server'
import anthropic, { CLASSIFICATION_MODEL, MAX_TOKENS } from '@/lib/anthropic'
import type { ClassificationResult, ExtractedLine } from '@/types'

function buildClassificationPrompt(
  lines: ExtractedLine[],
  supplierName: string,
  supplierDefaultCode?: string | null
): string {
  const linesText = lines
    .map(
      (line, i) =>
        `Ligne ${i + 1}: "${line.description}" - HT: ${line.total_ht}€${line.tva_rate ? ` - TVA: ${line.tva_rate}%` : ''}`
    )
    .join('\n')

  const supplierHint = supplierDefaultCode
    ? `\nNote: Ce fournisseur (${supplierName}) est habituellement classé en compte ${supplierDefaultCode}. Utilise ce code par défaut sauf si la nature de la ligne indique clairement un autre compte.`
    : ''

  return `Tu es un expert-comptable français spécialisé dans le Plan Comptable Général (PCG).

Contexte : Facture du fournisseur "${supplierName}".${supplierHint}

Classifie chaque ligne de facture suivante selon le PCG français.

${linesText}

Pour chaque ligne, détermine :
1. Le code PCG le plus précis possible (ex: 6061 plutôt que 606)
2. Le libellé du compte
3. Un score de confiance entre 0 et 1
4. Le code journal approprié (AC=Achats, VE=Ventes, BQ=Banque, OD=Opérations diverses)
5. Un bref raisonnement

Règles de classification :
- Fournitures de bureau, papeterie → 6064
- Fournitures d'entretien, produits ménagers → 6063
- Électricité, gaz, eau → 6061
- Petit matériel, consommables → 6063
- Loyer immobilier → 6132
- Location matériel → 6135
- Assurances → 616
- Honoraires comptable/avocat → 6226
- Publicité, communication → 6231 ou 6233
- Téléphone, internet → 6262
- Frais postaux → 6261
- Entretien, réparations → 615
- Sous-traitance → 611
- Carburant → 6061
- Frais de déplacement → 6251
- Frais de réception → 6257
- Achats marchandises revente → 607
- Services bancaires → 627
- Logiciels, abonnements SaaS → 6156 ou 6135
- Formation → 6333 ou 6228

Réponds UNIQUEMENT avec le JSON suivant :
[
  {
    "line_index": 0,
    "pcg_code": "string",
    "pcg_label": "string",
    "confidence": 0.95,
    "reasoning": "string",
    "journal_code": "AC"
  }
]`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { lines, supplier_name, supplier_default_code } = body as {
      lines: ExtractedLine[]
      supplier_name: string
      supplier_default_code?: string | null
    }

    if (!lines || lines.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Aucune ligne à classifier' },
        { status: 400 }
      )
    }

    const prompt = buildClassificationPrompt(
      lines,
      supplier_name,
      supplier_default_code
    )

    const response = await anthropic.messages.create({
      model: CLASSIFICATION_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { success: false, error: "Pas de réponse de l'IA" },
        { status: 500 }
      )
    }

    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const classifications: ClassificationResult[] = JSON.parse(jsonText)

    return NextResponse.json({ success: true, classifications })
  } catch (error) {
    console.error('Classification error:', error)
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    return NextResponse.json(
      { success: false, error: `Erreur de classification : ${message}` },
      { status: 500 }
    )
  }
}
