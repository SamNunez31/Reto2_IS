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
    expect(el.textContent).toContain('Ya pasó la hora de salida');
  });

  it('no avisa si la salida es en el futuro', async () => {
    await abrir({ ...RESERVA, fecha_salida: '2099-01-01' });
    expect(el.textContent).not.toContain('Ya pasó la hora de salida');
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

  const agregar = async (): Promise<void> => {
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Agregar consumo')) as HTMLButtonElement).click();
    await refrescar();
  };

  it('con consumos envía líneas, método de cobro y muestra subtotal y total', async () => {
    await abrir();
    await agregar();
    expect((el.querySelector('.sd-in-cant') as HTMLInputElement).value).toBe('1'); // cantidad por defecto
    await escribir('.sd-in-item', 'Agua');
    await escribir('.sd-in-cant', '2');
    await escribir('.sd-in-precio', '1,5'); // acepta coma
    expect(el.querySelector('.sd-subtotal')?.textContent).toContain('$3.00');
    expect(el.querySelector('.sd-total')?.textContent).toContain('$3.00');
    await llaves();
    boton().click();
    expect(enviados[0].consumos).toEqual([{ item: 'Agua', cantidad: 2, precio: '1.50' }]);
    expect(enviados[0].metodo_pago_consumos).toBe('EFECTIVO');
  });

  it('un consumo a medias muestra el error junto al campo y no envía', async () => {
    await abrir();
    await agregar();
    await escribir('.sd-in-item', 'Snack');
    await llaves();
    boton().click();
    await refrescar();
    expect(enviados.length).toBe(0);
    expect(el.querySelector('.sd-precio .sd-error')?.textContent).toContain('Ej. 3.50');
    expect(el.querySelector('.sd-item .sd-error')).toBeNull();
  });

  it('una línea agregada sin querer (vacía) se ignora', async () => {
    await abrir();
    await agregar();
    await llaves();
    boton().click();
    expect(enviados).toEqual([{}]);
  });

  it('un precio de 0 o negativo no es válido', async () => {
    await abrir();
    await agregar();
    await escribir('.sd-in-item', 'Agua');
    await escribir('.sd-in-precio', '0');
    await llaves();
    boton().click();
    await refrescar();
    expect(enviados.length).toBe(0);
  });

  it('el fondo no cierra el diálogo si ya hay datos escritos, pero sí si está vacío', async () => {
    await abrir();
    let cierres = 0;
    fixture.componentInstance.cerrar.subscribe(() => cierres++);
    const dialogo = el.querySelector('dialog') as HTMLDialogElement;
    dialogo.dispatchEvent(new MouseEvent('click'));
    expect(cierres).toBe(1);
    await agregar();
    await escribir('.sd-in-item', 'Agua');
    dialogo.dispatchEvent(new MouseEvent('click'));
    expect(cierres).toBe(1); // no cerró: se habrían perdido los datos
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Todavía no')) as HTMLButtonElement).click();
    expect(cierres).toBe(2); // «Todavía no» sí cierra
  });

  it('quitar un consumo lo elimina de la lista', async () => {
    await abrir();
    await agregar();
    await agregar();
    expect(el.querySelectorAll('.sd-linea').length).toBe(2);
    (el.querySelector('.sd-quitar') as HTMLButtonElement).click();
    await refrescar();
    expect(el.querySelectorAll('.sd-linea').length).toBe(1);
  });
});
