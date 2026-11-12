import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { DetalleComponent } from './detalle.component';

describe('DetalleComponent · «Volver»', () => {
  const crear = () => {
    TestBed.configureTestingModule({ imports: [DetalleComponent], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(DetalleComponent);
    fixture.componentRef.setInput('id', '1');
    return fixture;
  };
  afterEach(() => history.replaceState(null, ''));

  it('vuelve al inicio por defecto', () => {
    history.replaceState(null, '');
    expect(crear().componentInstance.desdeAdmin).toBeFalse();
  });

  it('vuelve al listado de alojamientos del admin solo si se llegó desde el panel', () => {
    history.replaceState({ desde: 'admin' }, '');
    expect(crear().componentInstance.desdeAdmin).toBeTrue();
  });
});
