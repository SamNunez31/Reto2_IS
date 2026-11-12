import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DatosSalida, ReservaHost } from '../../core/services/anfitrion.service';
import { SalidaDialogoComponent } from './salida-dialogo.component';

const RESERVA: ReservaHost = {
  id: 'r1', codigo: 'BK-079C37F1', estado: 'CONFIRMADA', alojamiento: 'Prueba Martes', alojamiento_codigo: 7,
  huesped: 'ESB Booking Cuenta de servicio', fecha_entrada: '2020-11-12', fecha_salida: '2020-11-14', num_huespedes: 2, total: 119,
  created_at: '2020-11-10T20:26:00Z', metodo_pago: 'TARJETA', estado_pago: 'APROBADO', canal_booking: true, checkin_en: '2020-11-12T19:00:00Z',
  checkout_en: null, habitacion_asignada: 'Suite Familiar 109', hora_checkout: '12:00:00',
  titular_nombre: 'Liz Cadena', titular_tipo_documento: 'CEDULA', titular_identificacion: '1722718150',
};

describe('SalidaDialogoComponent', () => {
  let fixture: ComponentFixture<SalidaDialogoComponent>;
  let el: HTMLElement;
  let enviados: DatosSalida[];

  const refrescar = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const abrir = async (r: ReservaHost | null = RESERVA): Promise<void> => {
    fixture.componentRef.setInput('reserva', r);
    await refrescar();
  };
  const boton = (): HTMLButtonElement => el.querySelector('button[type="submit"]') as HTMLButtonElement;
  const llaves = async (): Promise<void> => {
    (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    await refrescar();
  };
  const escribir = async (selector: string, valor: string): Promise<void> => {
    const c = el.querySelector(selector) as HTMLInputElement;
    c.value = valor;
    c.dispatchEvent(new Event('input'));
    await refrescar();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SalidaDialogoComponent] });
    fixture = TestBed.createComponent(SalidaDialogoComponent);
    el = fixture.nativeElement as HTMLElement;
    enviados = [];
    fixture.componentInstance.confirmar.subscribe((d) => enviados.push(d));
  });

  it('muestra titular, habitación y hora de salida prevista', async () => {
    await abrir();
    expect(el.textContent).toContain('Liz Cadena');
    expect(el.textContent).toContain('Suite Familiar 109');
    expect(el.textContent).toContain('12:00');
  });

  it('avisa de salida tardía cuando ya pasó la hora de check-out', async () => {
    await abrir();
    expect(el.textContent).toContain('posterior a la hora de check-out');
  });

  it('no avisa si la salida es en el futuro', async () => {
    await abrir({ ...RESERVA, fecha_salida: '2099-01-01' });
    expect(el.textContent).not.toContain('posterior a la hora de check-out');
  });

  it('no deja confirmar sin recibir las llaves', async () => {
    await abrir();
    expect(boton().disabled).toBe(true);
    await llaves();
    expect(boton().disabled).toBe(false);
  });

  it('sin consumos confirma solo con lo básico', async () => {
    await abrir();
    await llaves();
    boton().click();
    expect(enviados).toEqual([{}]);
  });

  it('con consumos envía líneas, método de cobro y muestra el total', async () => {
    await abrir();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Agregar consumo')) as HTMLButtonElement).click();
    await refrescar();
    await escribir('.sd-linea input[type="text"]:not([inputmode])', 'Agua');
    await escribir('.sd-linea input[type="number"]', '2');
    await escribir('.sd-linea input[inputmode="decimal"]', '1.5');
    expect(el.textContent).toContain('$3.00');
    await llaves();
    boton().click();
    expect(enviados[0].consumos).toEqual([{ item: 'Agua', cantidad: 2, precio: '1.50' }]);
    expect(enviados[0].metodo_pago_consumos).toBe('EFECTIVO');
  });

  it('un consumo a medias bloquea el envío con un mensaje', async () => {
    await abrir();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Agregar consumo')) as HTMLButtonElement).click();
    await refrescar();
    await escribir('.sd-linea input[type="text"]:not([inputmode])', 'Snack');
    await llaves();
    boton().click();
    await refrescar();
    expect(enviados.length).toBe(0);
    expect(el.textContent).toContain('Cada consumo necesita');
  });
});
