import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReservaHost } from '../../core/services/anfitrion.service';
import { CheckinDialogoComponent, DatosCheckin } from './checkin-dialogo.component';

const RESERVA: ReservaHost = {
  id: 'r1', codigo: 'BK-079C37F1', estado: 'CONFIRMADA', alojamiento: 'Prueba Martes', alojamiento_codigo: 7,
  huesped: 'ESB Booking Cuenta de servicio', fecha_entrada: '2026-11-12', fecha_salida: '2026-11-14', num_huespedes: 2, total: 119,
  created_at: '2026-11-10T20:26:00Z', metodo_pago: 'TARJETA', estado_pago: 'APROBADO', canal_booking: true, checkin_en: null, checkout_en: null, habitacion_asignada: null, hora_checkout: '12:00:00',
  titular_nombre: 'Liz Cadena', titular_tipo_documento: 'CEDULA', titular_identificacion: '1722718150', motivo_cancelacion: null, cancelada_por: null, cancelada_en: null,
};

describe('CheckinDialogoComponent', () => {
  let fixture: ComponentFixture<CheckinDialogoComponent>;
  let el: HTMLElement;
  let enviados: DatosCheckin[];
  let cierres: number;

  const abrir = async (r: ReservaHost | null = RESERVA): Promise<void> => {
    fixture.componentRef.setInput('reserva', r);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const boton = (): HTMLButtonElement => el.querySelector('button[type="submit"]') as HTMLButtonElement;
  const marcar = async (): Promise<void> => {
    (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const escribir = async (selector: string, valor: string): Promise<void> => {
    const campo = el.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CheckinDialogoComponent] });
    fixture = TestBed.createComponent(CheckinDialogoComponent);
    el = fixture.nativeElement as HTMLElement;
    enviados = [];
    cierres = 0;
    fixture.componentInstance.confirmar.subscribe((d) => enviados.push(d));
    fixture.componentInstance.cerrar.subscribe(() => cierres++);
  });

  it('muestra el código, el titular real y su cédula', async () => {
    await abrir();
    const texto = el.textContent ?? '';
    expect(texto).toContain('BK-079C37F1');
    expect(texto).toContain('Liz Cadena');
    expect(texto).toContain('Cédula');
    expect(texto).toContain('1722718150');
    expect(texto).toContain('Prueba Martes');
    expect(texto).toContain('2 noches');
  });

  it('sin documento en la reserva, no muestra la fila de cédula', async () => {
    await abrir({ ...RESERVA, titular_identificacion: null, titular_nombre: null, titular_tipo_documento: null });
    expect(el.textContent).not.toContain('Cédula');
    expect(el.textContent).toContain('ESB Booking Cuenta de servicio');
  });

  it('el botón queda desactivado hasta verificar el documento', async () => {
    await abrir();
    expect(boton().disabled).toBeTrue();
    await marcar();
    expect(boton().disabled).toBeFalse();
  });

  it('confirma con los huéspedes reales y las observaciones sin espacios sobrantes', async () => {
    await abrir();
    await escribir('#ck-reales', '3');
    await escribir('#ck-obs', '  llegó tarde  ');
    await marcar();
    boton().click();
    expect(enviados).toEqual([{ huespedes_reales: 3, observaciones: 'llegó tarde' }]);
  });

  it('sin observaciones no las envía; los huéspedes empiezan con los reservados', async () => {
    await abrir();
    await marcar();
    boton().click();
    expect(enviados).toEqual([{ huespedes_reales: 2 }]);
  });

  it('rechaza un número de huéspedes fuera de 1 a 30', async () => {
    await abrir();
    await escribir('#ck-reales', '31');
    await marcar();
    boton().click();
    fixture.detectChanges();
    expect(enviados).toEqual([]);
    expect(el.querySelector('#ck-error-reales')?.textContent).toContain('entre 1 y 30');
  });

  it('"Todavía no" cierra sin enviar nada', async () => {
    await abrir();
    (el.querySelector('.ck-acciones button[type="button"]') as HTMLButtonElement).click();
    expect(cierres).toBe(1);
    expect(enviados).toEqual([]);
  });

  it('al reabrirlo para otra reserva, la casilla vuelve a estar sin marcar', async () => {
    await abrir();
    await marcar();
    await abrir(null);
    await abrir({ ...RESERVA, id: 'r2', codigo: 'BK-OTRA0001' });
    expect(boton().disabled).toBeTrue();
  });
});

describe('CheckinDialogoComponent · habitación de la reserva', () => {
  let fixture: ComponentFixture<CheckinDialogoComponent>;
  let el: HTMLElement;
  const abrir = async (r: ReservaHost): Promise<void> => {
    fixture.componentRef.setInput('reserva', r);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CheckinDialogoComponent] });
    fixture = TestBed.createComponent(CheckinDialogoComponent);
    el = fixture.nativeElement as HTMLElement;
  });

  it('muestra la habitación que ya traía la reserva y no pide elegir ninguna', async () => {
    await abrir({ ...RESERVA, habitacion_asignada: 'Habitación Individual 101' });
    expect(el.textContent).toContain('Habitación Individual 101');
    expect(el.querySelector('#ck-hab')).toBeNull();
  });

  it('sin habitación asignada no muestra esa fila', async () => {
    await abrir(RESERVA);
    expect(el.querySelector('dl')?.textContent).not.toContain('Habitación');
  });

  it('confirma sin enviar ninguna habitación', async () => {
    await abrir(RESERVA);
    const enviados: DatosCheckin[] = [];
    fixture.componentInstance.confirmar.subscribe((d) => enviados.push(d));
    (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    expect(enviados[0]).toEqual({ huespedes_reales: 2 });
  });
});

describe('CheckinDialogoComponent · llegaron más huéspedes', () => {
  let fixture: ComponentFixture<CheckinDialogoComponent>;
  let el: HTMLElement;

  const refrescar = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [CheckinDialogoComponent] });
    fixture = TestBed.createComponent(CheckinDialogoComponent);
    el = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('reserva', RESERVA); // reservada para 2
    await refrescar();
  });

  it('con los huéspedes reservados no muestra aviso', () => {
    expect(el.textContent).not.toContain('más de los');
  });

  it('al subir el número avisa y ofrece las habitaciones libres de esas fechas', async () => {
    fixture.componentRef.setInput('sugerencias', [{ codigo_tipo: 'DOBLE', nombre: 'Habitación doble', capacidad: 2, precio_noche: 100, libres: 1 }]);
    fixture.componentRef.setInput('alojamientoCodigo', 1033);
    const campo = el.querySelector('#ck-reales') as HTMLInputElement;
    campo.value = '3';
    campo.dispatchEvent(new Event('input'));
    await refrescar();
    expect(el.textContent).toContain('Llegaron 1 huésped más de los 2 reservados');
    expect(el.textContent).toContain('Habitación doble');
    const enlace = el.querySelector('.ck-extra a') as HTMLAnchorElement;
    expect(enlace.getAttribute('href')).toBe('/alojamientos/1033?checkin=2026-11-12&checkout=2026-11-14&adultos=1');
  });

  it('si no queda nada libre lo dice claramente', async () => {
    const campo = el.querySelector('#ck-reales') as HTMLInputElement;
    campo.value = '4';
    campo.dispatchEvent(new Event('input'));
    await refrescar();
    expect(el.textContent).toContain('No quedan habitaciones libres');
  });
});
