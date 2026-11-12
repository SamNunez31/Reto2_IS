import { ICONOS, iconoTipo } from './iconos';

describe('Iconos del panel', () => {
  it('cada icono es una ruta SVG que empieza por un movimiento', () => {
    for (const [nombre, d] of Object.entries(ICONOS)) {
      expect(d.startsWith('M')).withContext(nombre).toBe(true);
    }
  });

  it('los tipos de alojamiento tienen su propio dibujo, con o sin tildes', () => {
    expect(iconoTipo('Hotel')).toBe(ICONOS['hotel']);
    expect(iconoTipo('Cabaña')).toBe(ICONOS['cabana']);
    expect(iconoTipo('Departamento')).toBe(ICONOS['departamento']);
  });

  it('un tipo desconocido cae en el icono de casa', () => {
    expect(iconoTipo('Yate')).toBe(ICONOS['casa']);
  });
});
