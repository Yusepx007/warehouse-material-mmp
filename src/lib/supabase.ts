import { createClient } from '@supabase/supabase-js';

// Fallback placeholder agar tidak crash saat build — runtime tetap pakai env asli
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-key';

export const supabase = createClient(supabaseUrl, supabaseKey);
