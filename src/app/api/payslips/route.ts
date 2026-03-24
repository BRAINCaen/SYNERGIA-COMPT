import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/lib/audit'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month')
    const employeeId = searchParams.get('employee_id')

    const snapshot = await adminDb
      .collection('payslips')
      .where('user_id', '==', decoded.uid)
      .get()

    let payslips = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => (b.month || '').localeCompare(a.month || '') || (a.employee_name || '').localeCompare(b.employee_name || ''))

    if (month) {
      const monthRegex = /^\d{4}-\d{2}$/
      if (!monthRegex.test(month)) {
        return NextResponse.json(
          { error: 'Format de mois invalide. Utilisez YYYY-MM' },
          { status: 400 }
        )
      }
      payslips = payslips.filter((p: any) => p.month === month)
    }

    if (employeeId) {
      payslips = payslips.filter((p: any) => p.employee_id === employeeId)
    }

    return NextResponse.json(payslips)
  } catch (error) {
    console.error('GET payslips error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const contentType = request.headers.get('content-type') || ''
    let body: Record<string, unknown>
    let file: File | null = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      file = formData.get('file') as File | null

      body = {
        employee_id: formData.get('employee_id') as string,
        employee_name: formData.get('employee_name') as string,
        month: formData.get('month') as string,
        gross_salary: parseFloat(formData.get('gross_salary') as string),
        net_salary: parseFloat(formData.get('net_salary') as string),
        employer_charges: parseFloat(formData.get('employer_charges') as string),
        advance_amount: parseFloat(formData.get('advance_amount') as string || '0'),
      }
    } else {
      body = await request.json()
    }

    // Validation
    if (!body.employee_name || !body.month || body.gross_salary == null || body.net_salary == null) {
      return NextResponse.json(
        { error: 'Champs obligatoires manquants : employee_name, month, gross_salary, net_salary' },
        { status: 400 }
      )
    }

    const monthRegex = /^\d{4}-\d{2}$/
    if (!monthRegex.test(body.month as string)) {
      return NextResponse.json(
        { error: 'Format de mois invalide. Utilisez YYYY-MM' },
        { status: 400 }
      )
    }

    const grossSalary = Number(body.gross_salary)
    const netSalary = Number(body.net_salary)
    const employerCharges = Number(body.employer_charges || 0)
    const advanceAmount = Number(body.advance_amount || 0)
    const remainingSalary = Math.round((netSalary - advanceAmount) * 100) / 100

    // Upload file to Storage if provided
    let filePath: string | null = null
    let fileName: string | null = null

    if (file) {
      if (file.type !== 'application/pdf') {
        return NextResponse.json(
          { error: 'Seuls les fichiers PDF sont acceptes' },
          { status: 400 }
        )
      }

      const rawBytes = new Uint8Array(await file.arrayBuffer())
      filePath = `payslips/${decoded.uid}/${Date.now()}_${crypto.randomUUID()}.pdf`
      fileName = file.name

      const bucket = adminStorage.bucket()
      const fileRef = bucket.file(filePath)
      await fileRef.save(Buffer.from(rawBytes), {
        metadata: { contentType: 'application/pdf' },
      })
    }

    const docRef = adminDb.collection('payslips').doc()
    const payslipData = {
      id: docRef.id,
      user_id: decoded.uid,
      employee_id: body.employee_id || null,
      employee_name: body.employee_name,
      month: body.month,
      gross_salary: grossSalary,
      net_salary: netSalary,
      employer_charges: employerCharges,
      advance_amount: advanceAmount,
      remaining_salary: remainingSalary,
      file_path: filePath,
      file_name: fileName,
      status: 'draft',
      matched_transaction_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await docRef.set(payslipData)

    await writeAuditLog({
      action: 'payslip.create',
      invoice_id: docRef.id,
      user_id: decoded.uid,
      after: payslipData as unknown as Record<string, unknown>,
    })

    return NextResponse.json({ success: true, payslip: payslipData })
  } catch (error) {
    console.error('POST payslips error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
