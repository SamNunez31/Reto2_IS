import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AnfitrionService, HabitacionHost, ResumenAlojamiento } from '../../core/services/anfitrion.service';
import { HabitacionesComponent } from './habitaciones.component';

const hotel = (codigo: number, tipo = 'Hotel'): ResumenAlojamiento =>
  ({ codigo, nombre: `Hotel ${codigo}`, tipo }) as ResumenAlojamiento;
const hab = (id: string, numero: string, estado: HabitacionHost['estado']): HabitacionHost => ({
  id, numero, estado, actualizada_en: '2026-11-11T10:00:00Z', alojamiento_codigo: 7, alojamiento: 'Hotel 7', unidad: 'Suite', reserva_codigo: null,
});

describe('HabitacionesComponent', () => {
  const crear = (habitaciones: HabitacionHost[]) => {
    const api = {
      alojamientos: jasmine.createSpy('alojamientos').and.returnValue(of([hotel(7), hotel(8, 'Casa')])),
      habitaciones: jasmine.createSpy('habitaciones').and.callFake(() => of(habitaciones)),
      estadoHabitacion: jasmine.createSpy('estadoHabitacion').and.returnValue(of({ id: 'h2', estado: 'DISPONIBLE' })),
    };
    TestBed.configureTestingModule({ imports: [HabitacionesComponent], providers: [{ provide: AnfitrionService, useValue: api }] });
    const fixture = TestBed.createComponent(HabitacionesComponent);
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  };

  it('ofrece todos los alojamientos (hoteles, casas…) y carga las unidades del primero', () => {
    const { fixture, api, el } = crear([hab('h1', '101', 'DISPONIBLE'), hab('h2', '102', 'EN_PREPARACION'), hab('h3', '103', 'OCUPADA')]);
    expect(Array.from(el.querySelectorAll('select option')).length).toBe(2);
    expect(api.habitaciones).toHaveBeenCalledWith(7);
    expect(fixture.componentInstance.cuenta()).toEqual({ DISPONIBLE: 1, EN_PREPARACION: 1, OCUPADA: 1 });
  });

  it('una habitación en preparación se puede marcar disponible; una ocupada no tiene acciones', () => {
    const { el, api, fixture } = crear([hab('h2', '102', 'EN_PREPARACION'), hab('h3', '103', 'OCUPADA')]);
    const filas = el.querySelectorAll('tbody tr');
    expect(filas[1].querySelector('button')).toBeNull();
    (filas[0].querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(api.estadoHabitacion).toHaveBeenCalledWith(7, 'h2', 'DISPONIBLE');
  });

  it('una habitación disponible se puede pasar a en preparación', () => {
    const { el, api } = crear([hab('h1', '101', 'DISPONIBLE')]);
    (el.querySelector('tbody button') as HTMLButtonElement).click();
    expect(api.estadoHabitacion).toHaveBeenCalledWith(7, 'h1', 'EN_PREPARACION');
  });
});
