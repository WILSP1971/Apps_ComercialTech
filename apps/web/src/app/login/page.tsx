'use client';
import { FormEvent, useState } from 'react';
import { supabase } from '@/auth/supabase';
import { IcEscudo } from '@/componentes/iconos';

export default function Login() {
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const entrarConGoogle = () =>
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } });

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setError(null); setCargando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: correo, password: clave });
    setCargando(false);
    if (error) {
      const m = (error.message ?? '').toLowerCase();
      setError(m.includes('invalid login') ? 'El correo o la contraseña no coinciden. Revise e intente de nuevo.'
        : m.includes('confirm') ? 'El correo aún no está confirmado en Supabase.'
        : m.includes('api key') || m.includes('apikey') ? 'La llave pública de Supabase no es válida en este sitio (revise NEXT_PUBLIC_SUPABASE_ANON_KEY).'
        : m.includes('fetch') || m.includes('network') ? 'No se pudo conectar con el servicio de autenticación.'
        : `No se pudo iniciar sesión: ${error.message}`);
      return;
    }
    window.location.replace('/');
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-borde bg-panel lg:block">
        <div className="absolute inset-0 opacity-60" style={{ background: 'radial-gradient(60rem 40rem at 20% 10%, rgb(var(--c-azul)/.22), transparent 60%), radial-gradient(40rem 30rem at 90% 90%, rgb(var(--c-violeta)/.18), transparent 60%)' }} />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-azul font-bold text-white">SI</div><span className="text-lg font-semibold">Sierra Innova</span></div>
          <div className="max-w-md">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight">Venda, fabrique y despache sin depender de la red.</h1>
            <p className="mt-4 text-suave">Pedidos, facturación, caja, inventarios y despacho en un solo lugar. Lo que haga sin conexión se envía solo cuando vuelva el internet.</p>
          </div>
          <p className="flex items-center gap-2 text-xs text-suave"><IcEscudo width={14} height={14} />Acceso protegido con OAuth 2.0 y PKCE</p>
        </div>
      </section>
      <section className="grid place-items-center p-6">
        <div className="w-full max-w-sm space-y-5">
          <div><h2 className="text-2xl font-semibold tracking-tight">Ingresar</h2><p className="mt-1 text-sm text-suave">Use la cuenta que le asignó su administrador.</p></div>
          <form onSubmit={entrar} className="space-y-3">
            <label className="block"><span className="etiqueta">Correo</span>
              <input className="campo" type="email" autoComplete="username" value={correo} onChange={e => setCorreo(e.target.value)} required /></label>
            <label className="block"><span className="etiqueta">Contraseña</span>
              <input className="campo" type="password" autoComplete="current-password" value={clave} onChange={e => setClave(e.target.value)} required /></label>
            {error && <p role="alert" className="aviso-caja a-rojo">{error}</p>}
            <button disabled={cargando} className="btn btn-primario btn-bloque">{cargando ? 'Entrando…' : 'Ingresar'}</button>
          </form>
          <div className="flex items-center gap-3 text-xs text-suave"><span className="h-px flex-1 bg-borde" />o<span className="h-px flex-1 bg-borde" /></div>
          <button onClick={entrarConGoogle} className="btn btn-bloque">Continuar con Google</button>
        </div>
      </section>
    </main>
  );
}
