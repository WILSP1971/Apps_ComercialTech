// src/auth/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,        // https://auth.sierrainnova.tech
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
