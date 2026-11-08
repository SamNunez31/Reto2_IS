import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API } from '../services/api-base';
import { apiInterceptor } from './api.interceptor';

describe('apiInterceptor — reintentos', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting()] });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  it('GET: reintenta tras un 502 y entrega la respuesta', fakeAsync(() => {
    let resp: unknown;
    http.get(`${API}/x`).subscribe((r) => (resp = r));
    ctrl.expectOne(`${API}/x`).flush('', { status: 502, statusText: 'Bad Gateway' });
    tick(1500);
    ctrl.expectOne(`${API}/x`).flush({ ok: 1 });
    expect(resp).toEqual({ ok: 1 });
  }));

  it('POST: no se reintenta', fakeAsync(() => {
    let status = 0;
    http.post(`${API}/x`, {}).subscribe({ error: (e) => (status = e.status) });
    ctrl.expectOne(`${API}/x`).flush('', { status: 502, statusText: 'Bad Gateway' });
    tick(5000);
    ctrl.expectNone(`${API}/x`);
    expect(status).toBe(502);
  }));
});
