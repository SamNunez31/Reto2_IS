import { etiquetaDireccion } from './geocodificacion.service';

describe('etiquetaDireccion (geocodificación inversa)', () => {
  it('arma «calle número, barrio, ciudad»', () => {
    expect(etiquetaDireccion({ display_name: 'x', address: { road: 'Avenida Amazonas', house_number: 'N24-03', suburb: 'La Mariscal', city: 'Quito' } }))
      .toBe('Avenida Amazonas N24-03, La Mariscal, Quito');
  });
  it('no repite partes y usa town/village si no hay city', () => {
    expect(etiquetaDireccion({ address: { road: 'Calle Sucre', neighbourhood: 'Centro', village: 'Centro' } })).toBe('Calle Sucre, Centro');
  });
  it('si hay muy poco detalle cae al nombre completo, recortado a 200', () => {
    const largo = 'a'.repeat(300);
    expect(etiquetaDireccion({ display_name: largo, address: { county: 'Pichincha' } })).toHaveSize(200);
  });
});
