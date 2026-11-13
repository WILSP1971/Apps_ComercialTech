import { IcSinRed } from '@/componentes/iconos';

export default function SinConexion() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-panel2 text-ambar"><IcSinRed width={24} height={24} /></div>
        <h1 className="text-xl font-semibold">Sin conexión</h1>
        <p className="text-sm text-suave">Esta página no está guardada en el dispositivo. Los pedidos, la caja y el despacho que ya abrió siguen funcionando, y lo que registre se enviará al volver la red.</p>
        <a href="/" className="btn btn-primario">Ir al menú principal</a>
      </div>
    </main>
  );
}
