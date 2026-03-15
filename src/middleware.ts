import { NextResponse, type NextRequest } from 'next/server'

// Firebase Auth tokens are managed client-side.
// API routes verify tokens via firebase-admin.
// This middleware only handles basic route protection via cookie check.
export async function middleware(request: NextRequest) {
  const authCookie = request.cookies.get('firebase-auth-token')

  const isAuthPage = request.nextUrl.pathname.startsWith('/login')
  const isApiRoute = request.nextUrl.pathname.startsWith('/api')
  const isAuthCallback = request.nextUrl.pathname.startsWith('/auth')

  // Skip API routes (they do their own auth check)
  if (isApiRoute || isAuthCallback) {
    return NextResponse.next()
  }

  // Redirect unauthenticated users to login
  if (!authCookie && !isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from login
  if (authCookie && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
