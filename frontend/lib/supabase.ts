import { createBrowserClient as _createBrowserClient } from '@supabase/ssr';
import { createServerClient as _createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface CookieStore {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void;
}

let browserClient: ReturnType<typeof _createBrowserClient> | null = null;

export function createBrowserClient() {
  if (browserClient) return browserClient;
  browserClient = _createBrowserClient(supabaseUrl, supabaseAnonKey);
  return browserClient;
}

let _cachedAccessToken: string | null = null;

export function setCachedAccessToken(token: string | null) {
  _cachedAccessToken = token;
}

export function getCachedAccessToken(): string | null {
  return _cachedAccessToken;
}

export function createServerClient(cookies: CookieStore) {
  return _createServerClient(supabaseUrl, supabaseAnonKey, { cookies });
}
