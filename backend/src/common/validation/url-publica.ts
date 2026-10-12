import { registerDecorator, ValidationOptions } from 'class-validator';

const SUFIJOS_INTERNOS = ['.localhost', '.local', '.internal', '.lan', '.home', '.home.arpa', '.intranet', '.corp'];

/**
 * ¿La URL apunta a un host público en https? Defensa anti-SSRF para URLs que el servidor visitará (webhooks):
 * rechaza http, credenciales en la URL, "localhost", nombres internos y CUALQUIER IP literal (IPv4/IPv6),
 * porque 127.0.0.1, 10.x, 169.254.169.254 (metadatos de la nube), etc. no son destinos legítimos.
 * Nota: esto valida el TEXTO. Al implementar el envío real hay que volver a validar la IP resuelta por DNS y no seguir redirecciones.
 */
export function esUrlPublicaHttps(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.startsWith('[')) return false; // IPv6 literal
  if (SUFIJOS_INTERNOS.some((s) => host.endsWith(s))) return false;
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false; // IPv4 literal (incluye formas raras)
  return host.includes('.'); // nombres sin punto (p. ej. "intranet") son internos
}

/** Decorador de class-validator: la propiedad debe ser una URL https pública (ver esUrlPublicaHttps). */
export function UrlPublicaHttps(opciones?: ValidationOptions) {
  return (objeto: object, propiedad: string) =>
    registerDecorator({
      name: 'urlPublicaHttps',
      target: objeto.constructor,
      propertyName: propiedad,
      options: { message: 'url debe ser https pública (sin IP, localhost ni credenciales)', ...opciones },
      validator: { validate: (v: unknown) => esUrlPublicaHttps(v) },
    });
}
