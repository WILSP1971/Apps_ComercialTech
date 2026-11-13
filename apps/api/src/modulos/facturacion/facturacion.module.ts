import { Module, OnModuleInit } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';
import { BusEventos } from '../../infraestructura/eventos';
import { PedidosModule } from '../pedidos/pedidos.module';
import { CarteraConsultas } from './aplicacion/cartera.consultas';
import { FacturacionCasosUso } from './aplicacion/facturacion.casos-uso';
import { FacturacionController } from './presentacion/facturacion.controller';

@Module({
  imports: [PedidosModule],                       // PedidosApi (API pública de Pedidos)
  controllers: [FacturacionController],
  providers: [FacturacionCasosUso, CarteraConsultas],
})
export class FacturacionModule implements OnModuleInit {
  constructor(private readonly bus: BusEventos, private readonly bd: BaseDatos) {}

  onModuleInit() {
    // R7: un cobro en caja asociado a una factura crea el pago; el trigger recalcula el saldo.
    // Si el pago excede el saldo, ck_r7_saldo_en_rango lo rechaza y el despachador reintenta/registra el fallo.
    this.bus.suscribir('caja.CobroRegistrado', async (e) => {
      const p = e.payload;
      if (!p.facturaId) return;                   // cobro sin factura (anticipo, mostrador)
      await this.bd.consultar(
        `INSERT INTO facturacion.pago_factura (id, empresa_id, factura_id, movimiento_caja_id, valor, medio_pago)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) ON CONFLICT (movimiento_caja_id) DO NOTHING`,
        [e.empresa_id, p.facturaId, p.movimientoId, p.valor, p.medioPago]);
    });

    // R9: un reverso en caja deja el pago como REVERSADO (el trigger R7 restaura el saldo)
    this.bus.suscribir('caja.MovimientoReversado', async (e) => {
      await this.bd.consultar(
        `UPDATE facturacion.pago_factura SET estado='REVERSADO' WHERE movimiento_caja_id=$1 AND empresa_id=$2`,
        [e.payload.movimientoOriginalId, e.empresa_id]);
    });

    // Marca el pedido como facturado (referencia lógica, sin FK entre esquemas)
    this.bus.suscribir('facturacion.FacturaEmitida', async (e) => {
      await this.bd.consultar(
        `UPDATE pedidos.pedido SET factura_id=$1 WHERE id=$2 AND empresa_id=$3`,
        [e.payload.facturaId, e.payload.pedidoId, e.empresa_id]);
    });
    // Aquí se conecta el adaptador del proveedor tecnológico DIAN (transmisión reintentable, guarda el CUFE).
  }
}
