import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import anthropic, { CLASSIFICATION_MODEL, MAX_TOKENS } from '@/lib/anthropic'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString('base64')

    const prompt = `Tu es un expert-comptable français. Analyse ce document PDF (facture de prestation, relevé TPE, bordereau de chèques, courrier de subvention, ticket de caisse, bordereau ANCV, etc.) et extrais les informations d'encaissement.

Réponds UNIQUEMENT en JSON valide, sans commentaire :
{
  "document_type": "encaissement" ou "subvention",
  "source": "tpe_virtuel" | "virement" | "tpe_sur_place" | "cheque" | "ancv" | "especes" | "billetterie" | "prestation" | "subvention",
  "entity_name": "nom du client, organisme ou payeur",
  "date": "YYYY-MM-DD",
  "description": "description courte du document/encaissement",
  "amount_ht": nombre HT (sans TVA), mettre le TTC si pas de TVA détaillée,
  "tva_rate": taux TVA principal en % (0 si pas de TVA ou exonéré),
  "amount_ttc": nombre TTC,
  "reference": "numéro de facture, référence ou null si absent",
  "items": [{"description": "ligne de détail", "amount": nombre}]
}

Règles :
- source "billetterie" = ventes de billets, escape game, activités loisirs
- source "prestation" = factures de prestations, team building, événementiel
- source "subvention" = courrier/notification de subvention publique
- source "tpe_virtuel" = paiement en ligne, e-commerce
- source "tpe_sur_place" = terminal de paiement physique
- source "virement" = virement bancaire reçu
- source "cheque" = paiement par chèque
- source "ancv" = chèques vacances ANCV
- source "especes" = paiement en espèces
- Si le document contient plusieurs lignes, les mettre dans items
- Montants en nombres avec point décimal (1234.56)
- Si le montant HT n'est pas explicite, calculer : amount_ht = amount_ttc / (1 + tva_rate/100)
- Si pas de TVA mentionnée, tva_rate = 0 et amount_ht = amount_ttc`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: prompt },
    ]

    // Call Claude with retry on 429
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let response: any
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await (anthropic.messages.create as any)({
          model: CLASSIFICATION_MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content }],
        })
        break
      } catch (e: any) {
        if ((e?.status === 429 || e?.status === 529) && attempt < 2) {
          await new Promise(r => setTimeout(r, 10000 * (attempt + 1)))
          continue
        }
        throw e
      }
    }

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'Pas de reponse IA' }, { status: 500 })
    }

    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const data = JSON.parse(jsonText)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Extract revenue error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur extraction' },
      { status: 500 }
    )
  }
}
