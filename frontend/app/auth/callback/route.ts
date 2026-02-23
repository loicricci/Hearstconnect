import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

const ALLOWED_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_DOMAIN || 'hearst.com';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const response = NextResponse.redirect(`${origin}/hearst-connect/btc-price-curve`);

  const supabase = createServerClient({
    getAll() {
      return request.cookies.getAll().map(c => ({ name: c.name, value: c.value }));
    },
    setAll(cookies) {
      cookies.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const email = data.session.user.email ?? '';
  const domain = email.split('@')[1];

  if (domain !== ALLOWED_DOMAIN) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=unauthorized_domain`);
  }

  return response;
}
