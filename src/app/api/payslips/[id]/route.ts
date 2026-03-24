import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/lib/audit'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const doc = await adminDb.collection('payslips').doc(params.id).get()
    if (!doc.exists) {
      return NextResponse.json({ error: 'Bulletin non trouve' }, { status: 404 })
    }

    const data = doc.data()!
    if (data.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 403 })
    }

    return NextResponse.json({ id: doc.id, ...data })
  } catch (error) {
    console.error('GET payslip error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const doc = await adminDb.collection('payslips').doc(params.id).get()
    if (!doc.exists) {
      return NextResponse.json({ error: 'Bulletin non trouve' }, { status: 404 })
    }

    const existing = doc.data()!
    if (existing.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 403 })
    }

    const body = await request.json()

    // Allowed fields to update
    const allowedFields = [
      'employee_name', 'employee_id', 'month',
      'gross_salary', 'net_salary', 'employer_charges',
      'advance_amount', 'status',
    ]

    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field]
      }
    }

    // Recalculate remaining_salary if relevant fields changed
    const netSalary = updates.net_salary != null ? Number(updates.net_salary) : existing.net_salary
    const advanceAmount = updates.advance_amount != null ? Number(updates.advance_amount) : existing.advance_amount
    updates.remaining_salary = Math.round((netSalary - advanceAmount) * 100) / 100
    updates.updated_at = new Date().toISOString()

    await adminDb.collection('payslips').doc(params.id).update(updates)

    await writeAuditLog({
      action: 'payslip.update',
      invoice_id: params.id,
      user_id: decoded.uid,
      before: existing as unknown as Record<string, unknown>,
      after: updates,
    })

    return NextResponse.json({ success: true, updates })
  } catch (error) {
    console.error('PATCH payslip error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const doc = await adminDb.collection('payslips').doc(params.id).get()
    if (!doc.exists) {
      return NextResponse.json({ error: 'Bulletin non trouve' }, { status: 404 })
    }

    const existing = doc.data()!
    if (existing.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 403 })
    }

    await adminDb.collection('payslips').doc(params.id).delete()

    await writeAuditLog({
      action: 'payslip.delete',
      invoice_id: params.id,
      user_id: decoded.uid,
      before: existing as unknown as Record<string, unknown>,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE payslip error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
