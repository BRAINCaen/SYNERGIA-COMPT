import { adminAuth } from './admin'
import { NextRequest } from 'next/server'

export async function verifyAuth(request: NextRequest) {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  const token = authorization.split('Bearer ')[1]
  try {
    const decoded = await adminAuth.verifyIdToken(token)
    return decoded
  } catch (error) {
    console.error('Auth verification error:', error)
    return null
  }
}
