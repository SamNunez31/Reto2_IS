import { esUrlPublicaHttps } from './url-publica';

describe('esUrlPublicaHttps (anti-SSRF)', () => {
  it.each(['https://miapp.com/hook', 'https://api.cliente.example.org:8443/webhooks?x=1'])('acepta %s', (u) => {
    expect(esUrlPublicaHttps(u)).toBe(true);
  });

  it.each([
    'http://miapp.com/hook',
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.5/x',
    'https://192.168.1.10/x',
    'https://2130706433/x',
    'https://0x7f000001/x',
    'https://[::1]/x',
    'https://servicio.internal/x',
    'https://impresora.local/x',
    'https://intranet/x',
    'https://usuario:clave@miapp.com/x',
    'ftp://miapp.com/x',
    'no es url',
    '',
  ])('rechaza %s', (u) => {
    expect(esUrlPublicaHttps(u)).toBe(false);
  });

  it('rechaza valores que no son texto', () => {
    expect(esUrlPublicaHttps(undefined)).toBe(false);
    expect(esUrlPublicaHttps(42)).toBe(false);
  });
});
