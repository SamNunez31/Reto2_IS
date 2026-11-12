import { TestBed } from '@angular/core/testing';
import { EstadoComponent } from './ui';

describe('EstadoComponent · nombre propio de cada pantalla', () => {
  it('usa el nombre que le pasa la pantalla cuando lo hay', () => {
    TestBed.configureTestingModule({ imports: [EstadoComponent] });
    const fixture = TestBed.createComponent(EstadoComponent);
    fixture.componentRef.setInput('estado', 'BORRADOR');
    fixture.componentRef.setInput('nombre', 'Suspendido');
    fixture.detectChanges();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('.badge') as HTMLElement;
    expect(badge.textContent?.trim()).toBe('Suspendido');
    expect(badge.className).toContain('badge-borrador');
  });

  it('sin nombre propio mantiene el del estado', () => {
    TestBed.configureTestingModule({ imports: [EstadoComponent] });
    const fixture = TestBed.createComponent(EstadoComponent);
    fixture.componentRef.setInput('estado', 'BORRADOR');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('Borrador');
  });
});
