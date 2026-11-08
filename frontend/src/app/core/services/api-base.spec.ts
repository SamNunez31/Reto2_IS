import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { leerError } from './api-base';

describe('leerError', () => {
  it('agrega el código de soporte en errores 5xx', () => {
    const e = new HttpErrorResponse({ status: 500, error: { detail: 'Falló', code: 'X', correlation_id: 'abc-123' } });
    expect(leerError(e).mensaje).toContain('abc-123');
  });
  it('no agrega código en errores 4xx', () => {
    const e = new HttpErrorResponse({ status: 422, error: { detail: 'Dato inválido', code: 'V', correlation_id: 'abc-123' }, headers: new HttpHeaders() });
    expect(leerError(e).mensaje).toBe('Dato inválido');
  });
});
