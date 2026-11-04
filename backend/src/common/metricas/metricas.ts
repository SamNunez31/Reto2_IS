import { NextFunction, Request, Response } from 'express';

/**
 * Reto 2 (S10): métricas en formato Prometheus, sin dependencias.
 * Las 4 señales de oro: tráfico, errores, latencia (histograma) y saturación (memoria / event loop básico).
 * La etiqueta "ruta" usa la plantilla de Express (/orders/:orderId) para no explotar la cardinalidad.
 */
const BUCKETS_MS = [25, 50, 100, 200, 400, 800, 1600, 3200];

interface Serie { conteo: number; suma: number; buckets: number[] }
const series = new Map<string, Serie>(); // clave = metodo|ruta|clase_status
const inicio = Date.now();

function claseStatus(s: number): string {
  return `${Math.floor(s / 100)}xx`;
}

export function metricasMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/metrics') return next();
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const ruta = req.route?.path ? `${req.baseUrl ?? ''}${String(req.route.path)}` : 'desconocida';
    const clave = `${req.method}|${ruta}|${claseStatus(res.statusCode)}`;
    let s = series.get(clave);
    if (!s) {
      if (series.size >= 500) return; // tope de seguridad contra cardinalidad
      s = { conteo: 0, suma: 0, buckets: BUCKETS_MS.map(() => 0) };
      series.set(clave, s);
    }
    s.conteo++;
    s.suma += ms;
    BUCKETS_MS.forEach((b, i) => { if (ms <= b) s!.buckets[i]++; });
  });
  next();
}

export function renderizarMetricas(): string {
  const rol = process.env.SERVICE_ROLE || 'all';
  const l: string[] = [];
  l.push('# HELP posada_http_requests_total Peticiones HTTP atendidas.', '# TYPE posada_http_requests_total counter');
  for (const [k, s] of series) {
    const [m, r, c] = k.split('|');
    l.push(`posada_http_requests_total{servicio="${rol}",metodo="${m}",ruta="${r}",status="${c}"} ${s.conteo}`);
  }
  l.push('# HELP posada_http_request_duration_ms Latencia en milisegundos.', '# TYPE posada_http_request_duration_ms histogram');
  for (const [k, s] of series) {
    const [m, r, c] = k.split('|');
    const et = `servicio="${rol}",metodo="${m}",ruta="${r}",status="${c}"`;
    BUCKETS_MS.forEach((b, i) => l.push(`posada_http_request_duration_ms_bucket{${et},le="${b}"} ${s.buckets[i]}`));
    l.push(`posada_http_request_duration_ms_bucket{${et},le="+Inf"} ${s.conteo}`);
    l.push(`posada_http_request_duration_ms_sum{${et}} ${s.suma.toFixed(2)}`);
    l.push(`posada_http_request_duration_ms_count{${et}} ${s.conteo}`);
  }
  const mem = process.memoryUsage();
  l.push('# TYPE posada_process_resident_memory_bytes gauge', `posada_process_resident_memory_bytes{servicio="${rol}"} ${mem.rss}`);
  l.push('# TYPE posada_process_uptime_seconds gauge', `posada_process_uptime_seconds{servicio="${rol}"} ${Math.round((Date.now() - inicio) / 1000)}`);
  return l.join('\n') + '\n';
}

/** GET /metrics. Si METRICS_TOKEN está definido exige "Authorization: Bearer <token>". No se publica por el gateway. */
export function metricasHandler(req: Request, res: Response): void {
  const token = process.env.METRICS_TOKEN;
  if (token && req.header('authorization') !== `Bearer ${token}`) {
    res.status(401).json({ status: 401, code: 'UNAUTHORIZED', title: 'Unauthorized' });
    return;
  }
  res.type('text/plain; version=0.0.4').send(renderizarMetricas());
}
