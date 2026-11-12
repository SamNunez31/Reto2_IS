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

describe('HabitacionesComponent · ciclo de limpieza', () => {
  it('muestra la fecha de la última limpieza en las disponibles y el pendiente en las que están en preparación', () => {
    const api = {
      alojamientos: () => of([hotel(7)]),
      habitaciones: () => of([hab('h1', '101', 'DISPONIBLE'), hab('h2', '102', 'EN_PREPARACION'), hab('h3', '103', 'OCUPADA')]),
      estadoHabitacion: () => of({ id: 'h1', estado: 'DISPONIBLE' }),
    };
    TestBed.configureTestingModule({ imports: [HabitacionesComponent], providers: [{ provide: AnfitrionService, useValue: api }] });
    const fixture = TestBed.createComponent(HabitacionesComponent);
    fixture.detectChanges();
    const filas = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
    expect(filas[0].textContent).toContain('Limpia:');
    expect(filas[1].textContent).toContain('Pendiente desde');
    expect(filas[2].textContent).toContain('Ocupada desde');
  });
});

describe('HabitacionesComponent · cuándo se numera', () => {
  const montar = (habitaciones: HabitacionHost[]) => {
    const api = {
      alojamientos: () => of([hotel(7)]),
      habitaciones: () => of(habitaciones),
      estadoHabitacion: () => of({ id: 'h1', estado: 'DISPONIBLE' }),
    };
    TestBed.configureTestingModule({ imports: [HabitacionesComponent], providers: [{ provide: AnfitrionService, useValue: api }] });
    const fixture = TestBed.createComponent(HabitacionesComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('con varias unidades muestra el número', () => {
    const el = montar([hab('h1', '101', 'DISPONIBLE'), hab('h2', '102', 'DISPONIBLE')]);
    expect(el.querySelector('thead')?.textContent).toContain('N.º');
    expect(el.querySelector('tbody tr strong')?.textContent).toBe('101');
  });

  it('con una sola unidad muestra su nombre en vez de un 1 suelto', () => {
    const el = montar([{ ...hab('h1', '1', 'DISPONIBLE'), alojamiento: 'Casa Colón', unidad: 'Cabaña Familiar' }]);
    expect(el.querySelector('thead')?.textContent).toContain('Unidad');
    expect(el.querySelector('tbody tr strong')?.textContent).toBe('Casa Colón');
  });
});

describe('HabitacionesComponent · próxima reserva', () => {
  const base = (): HabitacionHost => ({
    id: 'h1', numero: '101', estado: 'DISPONIBLE', actualizada_en: '2026-11-11T10:00:00Z', alojamiento_codigo: 7, alojamiento: 'Hotel 7', unidad: 'Suite',
    reserva_codigo: null, proxima_codigo: 'BK-1', proxima_entrada: '2026-11-14', proxima_salida: '2026-11-16', proxima_huesped: 'Elizabeth Chávez',
  });
  const montar = (h: HabitacionHost[]) => {
    const api = {
      alojamientos: () => of([hotel(7)]), habitaciones: () => of(h), estadoHabitacion: () => of({ id: 'h1', estado: 'DISPONIBLE' }),
    };
    TestBed.configureTestingModule({ imports: [HabitacionesComponent], providers: [{ provide: AnfitrionService, useValue: api }] });
    const fixture = TestBed.createComponent(HabitacionesComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('muestra fechas y huésped de la próxima reserva', () => {
    const el = montar([base()]).nativeElement as HTMLElement;
    expect(el.textContent).toContain('14–16 nov');
    expect(el.textContent).toContain('Elizabeth Chávez');
  });

  it('«Reservada» solo si está disponible y la llegada es hoy o mañana', () => {
    const c = montar([base()]).componentInstance;
    expect(c.reservadaPronto(base(), new Date(2026, 10, 13))).toBeTrue();
    expect(c.reservadaPronto(base(), new Date(2026, 10, 14))).toBeTrue();
    expect(c.reservadaPronto(base(), new Date(2026, 10, 12))).toBeFalse();
    expect(c.reservadaPronto({ ...base(), estado: 'EN_PREPARACION' }, new Date(2026, 10, 13))).toBeFalse();
    expect(c.reservadaPronto({ ...base(), proxima_entrada: null }, new Date(2026, 10, 13))).toBeFalse();
  });

  it('el rango cambia de mes cuando hace falta', () => {
    const c = montar([base()]).componentInstance;
    expect(c.rangoCorto('2026-11-30', '2026-12-02')).toBe('30 nov–2 dic');
  });
});
