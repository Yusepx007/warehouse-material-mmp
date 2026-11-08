import { createClient } from '@supabase/supabase-js';

// URL dan key langsung hardcode — tidak bergantung env var
export const supabase = createClient(
  'https://qfjzkgofdgmywaarutvl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmanprZ29mZGdteXdhYXJ1dnRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNDI0OTcsImV4cCI6MjEwOTcxODQ5N30.skcev-s9AZtmBuakyRhCcl5iBwR903qQB6fddjk_dVM'
);
