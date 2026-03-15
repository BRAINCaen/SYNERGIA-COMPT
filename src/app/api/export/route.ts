import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

interface InvoiceData {
  id: string
  supplier_name: string | null
  supplier_siret: string | null
  invoice_number: string | null
  invoice_date: string | null
  total_ht: number | null
  total_tva: number | null
  total_ttc: number | null
  currency: string
  file_name: string
}

interface LineData {
  description: string
  pcg_code: string | null
  pcg_label: string | null
  journal_code: string | null
  total_ht: number
  tva_rate: number | null
  tva_amount: number | null
  total_ttc: number | null
  confidence_score: number | null
  manually_corrected: boolean
}

interface InvoiceWithLines extends InvoiceData {
  lines: LineData[]
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { invoice_ids, format } = await request.json() as {
      invoice_ids: string[]
      format: 'fec' | 'csv' | 'json'
    }

    if (!invoice_ids?.length) {
      return NextResponse.json({ error: 'Aucune facture sélectionnée' }, { status: 400 })
    }

    // Fetch invoices with lines
    const invoices: InvoiceWithLines[] = []

    for (const id of invoice_ids) {
      const doc = await adminDb.collection('invoices').doc(id).get()
      if (!doc.exists || doc.data()!.status !== 'validated') continue

      const linesSnap = await adminDb
        .collection('invoice_lines')
        .where('invoice_id', '==', id)
        .get()

      const invoiceData = doc.data() as InvoiceData
      invoices.push({
        ...invoiceData,
        id: doc.id,
        lines: linesSnap.docs.map((d) => d.data() as LineData),
      })
    }

    if (invoices.length === 0) {
      return NextResponse.json({ error: 'Aucune facture validée trouvée' }, { status: 404 })
    }

    let content: string
    let contentType: string
    let fileName: string

    switch (format) {
      case 'fec':
        content = generateFEC(invoices)
        contentType = 'text/plain; charset=utf-8'
        fileName = `FEC_${new Date().toISOString().slice(0, 10)}.txt`
        break
      case 'csv':
        content = generateCSV(invoices)
        contentType = 'text/csv; charset=utf-8'
        fileName = `export_${new Date().toISOString().slice(0, 10)}.csv`
        break
      case 'json':
        content = generateJSON(invoices)
        contentType = 'application/json; charset=utf-8'
        fileName = `export_${new Date().toISOString().slice(0, 10)}.json`
        break
      default:
        return NextResponse.json({ error: 'Format non supporté' }, { status: 400 })
    }

    // Save export record
    await adminDb.collection('export_history').add({
      user_id: decoded.uid,
      invoice_ids,
      format,
      created_at: new Date().toISOString(),
    })

    // Update invoices status
    const batch = adminDb.batch()
    for (const id of invoice_ids) {
      batch.update(adminDb.collection('invoices').doc(id), {
        status: 'exported',
        updated_at: new Date().toISOString(),
      })
    }
    await batch.commit()

    return new NextResponse(content, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

function generateFEC(invoices: InvoiceWithLines[]): string {
  const headers = [
    'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate',
    'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
    'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
    'EcritutureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
  ].join('|')

  const rows: string[] = [headers]
  let ecritureNum = 1

  for (const invoice of invoices) {
    const invoiceDate = invoice.invoice_date
      ? new Date(invoice.invoice_date).toISOString().slice(0, 10).replace(/-/g, '')
      : ''

    for (const line of invoice.lines) {
      if (!line.pcg_code) continue

      rows.push([
        line.journal_code || 'AC', getJournalLabel(line.journal_code || 'AC'),
        String(ecritureNum).padStart(6, '0'), invoiceDate,
        line.pcg_code, line.pcg_label || '', '', '',
        invoice.invoice_number || '', invoiceDate,
        line.description, formatAmount(line.total_ht), '0,00',
        '', '', invoiceDate, '', invoice.currency || 'EUR',
      ].join('|'))

      if (line.tva_amount && line.tva_amount > 0) {
        rows.push([
          line.journal_code || 'AC', getJournalLabel(line.journal_code || 'AC'),
          String(ecritureNum).padStart(6, '0'), invoiceDate,
          getTvaAccount(line.tva_rate), `TVA déductible ${line.tva_rate}%`, '', '',
          invoice.invoice_number || '', invoiceDate,
          `TVA ${line.tva_rate}% - ${line.description}`,
          formatAmount(line.tva_amount), '0,00',
          '', '', invoiceDate, '', invoice.currency || 'EUR',
        ].join('|'))
      }
    }

    if (invoice.total_ttc) {
      rows.push([
        'AC', 'Achats', String(ecritureNum).padStart(6, '0'), invoiceDate,
        '401000', 'Fournisseurs', invoice.supplier_siret || '', invoice.supplier_name || '',
        invoice.invoice_number || '', invoiceDate,
        `${invoice.supplier_name || 'Fournisseur'} - Facture ${invoice.invoice_number || ''}`,
        '0,00', formatAmount(invoice.total_ttc),
        '', '', invoiceDate, '', invoice.currency || 'EUR',
      ].join('|'))
    }

    ecritureNum++
  }

  return rows.join('\r\n')
}

function generateCSV(invoices: InvoiceWithLines[]): string {
  const headers = [
    'Date facture', 'N° facture', 'Fournisseur', 'SIRET', 'Description',
    'Compte PCG', 'Libellé compte', 'Journal', 'Montant HT', 'Taux TVA',
    'Montant TVA', 'Montant TTC', 'Confiance IA', 'Correction manuelle',
  ].join(';')

  const rows: string[] = [headers]

  for (const invoice of invoices) {
    for (const line of invoice.lines) {
      rows.push([
        invoice.invoice_date || '', invoice.invoice_number || '',
        csvEscape(invoice.supplier_name || ''), invoice.supplier_siret || '',
        csvEscape(line.description), line.pcg_code || '',
        csvEscape(line.pcg_label || ''), line.journal_code || '',
        formatAmount(line.total_ht), line.tva_rate ? `${line.tva_rate}%` : '',
        formatAmount(line.tva_amount), formatAmount(line.total_ttc),
        line.confidence_score ? `${Math.round(line.confidence_score * 100)}%` : '',
        line.manually_corrected ? 'Oui' : 'Non',
      ].join(';'))
    }
  }

  return '\uFEFF' + rows.join('\r\n')
}

function generateJSON(invoices: InvoiceWithLines[]): string {
  const exportData = invoices.map((inv) => ({
    invoice: {
      number: inv.invoice_number, date: inv.invoice_date,
      supplier: inv.supplier_name, siret: inv.supplier_siret,
      total_ht: inv.total_ht, total_tva: inv.total_tva, total_ttc: inv.total_ttc,
    },
    lines: inv.lines.map((line) => ({
      description: line.description, pcg_code: line.pcg_code,
      pcg_label: line.pcg_label, journal_code: line.journal_code,
      total_ht: line.total_ht, tva_rate: line.tva_rate,
      tva_amount: line.tva_amount, total_ttc: line.total_ttc,
      confidence: line.confidence_score, manually_corrected: line.manually_corrected,
    })),
  }))
  return JSON.stringify({ exported_at: new Date().toISOString(), invoices: exportData }, null, 2)
}

function formatAmount(amount: number | null | undefined): string {
  if (amount == null) return '0,00'
  return amount.toFixed(2).replace('.', ',')
}

function csvEscape(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function getJournalLabel(code: string): string {
  const journals: Record<string, string> = {
    AC: 'Achats', VE: 'Ventes', BQ: 'Banque', OD: 'Opérations diverses',
  }
  return journals[code] || code
}

function getTvaAccount(rate: number | null | undefined): string {
  if (!rate) return '445660'
  if (rate === 20) return '445662'
  if (rate === 10) return '445663'
  if (rate === 5.5) return '445664'
  if (rate === 2.1) return '445665'
  return '445660'
}
