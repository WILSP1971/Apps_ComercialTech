// src/app/login/page.tsx
'use client';
import { supabase } from '@/auth/supabase';

export default function Login() {
  const entrarConGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

  return (
    <main className="grid min-h-screen place-items-center">
      <button onClick={entrarConGoogle} className="rounded-xl bg-slate-900 px-6 py-3 text-white">
        Ingresar con Google
      </button>
    </main>
  );
}
