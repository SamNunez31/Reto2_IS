import { signal } from '@angular/core';
import { Paginacion } from './paginacion';

describe('Paginacion', () => {
  const lista = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it('divide la lista en páginas y muestra solo la actual', () => {
    const datos = signal(lista(25));
    const p = new Paginacion<number>(() => datos(), 10);
    expect(p.paginas()).toBe(3);
    expect(p.items()).toEqual(lista(10));
    p.mover(1);
    expect(p.items()[0]).toBe(11);
    p.mover(1);
    expect(p.items()).toEqual([21, 22, 23, 24, 25]);
  });

  it('no se sale de rango al avanzar de más ni al retroceder de más', () => {
    const p = new Paginacion<number>(() => lista(15), 10);
    p.mover(5);
    expect(p.actual()).toBe(1);
    p.mover(-9);
    expect(p.actual()).toBe(0);
  });

  it('si la lista se acorta, vuelve a la última página existente', () => {
    const datos = signal(lista(25));
    const p = new Paginacion<number>(() => datos(), 10);
    p.mover(2);
    datos.set(lista(12));
    expect(p.actual()).toBe(1);
    expect(p.items()).toEqual([11, 12]);
  });

  it('una lista vacía tiene una sola página y reiniciar vuelve a la primera', () => {
    const datos = signal<number[]>([]);
    const p = new Paginacion<number>(() => datos(), 10);
    expect(p.paginas()).toBe(1);
    expect(p.items()).toEqual([]);
    datos.set(lista(30));
    p.mover(2);
    p.reiniciar();
    expect(p.actual()).toBe(0);
  });
});
