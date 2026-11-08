import { createClient } from '@supabase/supabase-js';

// NEXT_PUBLIC_ vars harus tersedia saat build di Vercel (tipe Config, bukan Secret)
// Fallback ke nilai real agar tidak crash jika env belum di-set
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://qfjzkgofdgmywaarutvl.supabase.co';

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmanprZ29mZGdteXdhYXJ1dnRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNDI0OTcsImV4cCI6MjEwOTcxODQ5N30.skcev-s9AZtmBuakyRhCcl5iBwR903qQB6fddjk_dVM';

export const supabase = createClient(supabaseUrl, supabaseKey);
