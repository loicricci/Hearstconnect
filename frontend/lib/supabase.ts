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

export function createServerClient(cookies: CookieStore) {
  return _createServerClient(supabaseUrl, supabaseAnonKey, { cookies });
}
