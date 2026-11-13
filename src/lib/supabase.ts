import { createClient } from '@supabase/supabase-js';

// This application is bound to the warehouse Supabase project. Pinning the
// public project URL prevents a stale/mistyped Vercel URL from breaking auth.
export const supabaseUrl = 'https://qfjzkgofdgmywaaruvtl.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseAnonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY atau NEXT_PUBLIC_SUPABASE_ANON_KEY wajib diatur.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
