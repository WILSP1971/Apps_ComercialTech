// src/app/auth/callback/page.tsx   (el SDK intercambia el "code" por tokens usando el verificador PKCE)
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/auth/supabase';

export default function Callback() {
  const router = useRouter();
  useEffect(() => {
    supabase.auth.getSession().then(() => router.replace('/'));
  }, [router]);
  return <p>Validando sesión…</p>;
}
