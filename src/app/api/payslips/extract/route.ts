import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import anthropic, { CLASSIFICATION_MODEL, MAX_TOKENS } from '@/lib/anthropic'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString('base64')

    const prompt = `Extrais TOUTES les informations de ce bulletin de paie français.

Réponds UNIQUEMENT en JSON valide :
{
  "employee_name": "NOM Prénom",
  "employee_role": "poste/fonction ou null",
  "period": "YYYY-MM",
  "gross_salary": nombre,
  "net_salary_before_tax": nombre,
  "net_salary_after_tax": nombre,
  "employer_charges": nombre,
  "employee_charges": nombre,
  "advance_amount": nombre_ou_0,
  "remaining_to_pay": nombre,
  "hours_worked": nombre_ou_null,
  "bonuses": [{"label": "nom prime", "amount": nombre}],
  "contract_type": "CDI/CDD/Apprentissage ou null",
  "cumul_brut_annuel": nombre_ou_null
}

Montants en nombres avec point décimal (1234.56). advance_amount = 0 si aucun acompte.`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messageContent: any[] = [
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
          messages: [{ role: 'user', content: messageContent }],
        })
        break
      } catch (e: any) {
        if (e?.status === 429 && attempt < 2) {
          await new Promise(r => setTimeout(r, 10000 * (attempt + 1)))
          continue
        }
        throw e
      }
    }

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'Pas de réponse IA' }, { status: 500 })
    }

    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const data = JSON.parse(jsonText)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Extract payslip error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur' }, { status: 500 })
  }
}
