import { condicionDeReferencia } from './alojamientos-v2.service';

describe('{orderId} de las rutas de orden: llaves aceptadas', () => {
  it('UUID técnico', () => {
    expect(condicionDeReferencia('7b8be3ab-bfa1-476a-a2ab-5fbcd8e2d876')).toEqual(['reserva.id = $1::uuid', '7b8be3ab-bfa1-476a-a2ab-5fbcd8e2d876']);
  });
  it('external_order_id ORD-HTL-… y codigoReserva BK-HOTEL-… apuntan a la misma reserva BK-…', () => {
    expect(condicionDeReferencia('ORD-HTL-079C37F1')).toEqual(['reserva.codigo = $1', 'BK-079C37F1']);
    expect(condicionDeReferencia('BK-HOTEL-079C37F1')).toEqual(['reserva.codigo = $1', 'BK-079C37F1']);
  });
  it('el código de Booking BKG-… se busca por saga_id / payment_reference (no es un 400)', () => {
    const [cond, valor] = condicionDeReferencia('BKG-763424');
    expect(valor).toBe('BKG-763424');
    expect(cond).toContain('saga_id = $1 OR payment_reference = $1');
  });
  it('una referencia con formato desconocido sigue siendo 400', () => {
    expect(() => condicionDeReferencia('cualquier-cosa')).toThrow();
  });
});
