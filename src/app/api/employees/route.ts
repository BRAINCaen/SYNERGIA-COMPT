import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/lib/audit'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const snapshot = await adminDb
      .collection('employees')
      .where('user_id', '==', decoded.uid)
      .get()

    const employees = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))

    return NextResponse.json(employees)
  } catch (error) {
    console.error('GET employees error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const body = await request.json()

    if (!body.name) {
      return NextResponse.json(
        { error: 'Le nom est obligatoire' },
        { status: 400 }
      )
    }

    const docRef = adminDb.collection('employees').doc()
    const employeeData = {
      id: docRef.id,
      user_id: decoded.uid,
      name: body.name,
      role: body.role || null,
      monthly_gross: body.monthly_gross != null ? Number(body.monthly_gross) : null,
      is_active: body.is_active !== false,
      created_at: new Date().toISOString(),
    }

    await docRef.set(employeeData)

    await writeAuditLog({
      action: 'employee.create',
      invoice_id: docRef.id,
      user_id: decoded.uid,
      after: employeeData as unknown as Record<string, unknown>,
    })

    return NextResponse.json({ success: true, employee: employeeData })
  } catch (error) {
    console.error('POST employees error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
