import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import { logJson } from '../../common/logging/log-json';

/** Evento de negocio tal como sale de evento_outbox. */
export interface EventoNegocio {
  id: number;
  tipo: string;
  agregado: string;
  agregado_id: string;
  correlacion_id: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

export type Consumidor = (evento: EventoNegocio) => void | Promise<void>;

/**
 * Bus de eventos con RabbitMQ (exchange `posada.eventos`, tipo topic).
 * - Si AMQP_URL está definida: cada evento del outbox se publica en RabbitMQ (mensaje persistente)
 *   y cada consumidor lee de su propia cola durable, con ack manual.
 * - Si AMQP_URL no está definida (o RabbitMQ no responde al arrancar): funciona EN MEMORIA como antes,
 *   así el sistema no deja de operar. Los productores solo escriben en el outbox y no cambian.
 */
@Injectable()
export class BusEventos implements OnModuleInit, OnModuleDestroy {
  private static readonly EXCHANGE = 'posada.eventos';
  private readonly consumidores: { nombre: string; fn: Consumidor }[] = [];
  private ch?: amqp.Channel;
  private cerrar?: () => Promise<void>;

  async onModuleInit(): Promise<void> {
    const url = process.env.AMQP_URL;
    if (!url) {
      logJson('info', 'bus_eventos_memoria', { motivo: 'AMQP_URL vacío' });
      return;
    }
    try {
      const conn = await amqp.connect(url);
      this.cerrar = () => conn.close();
      this.ch = await conn.createChannel();
      await this.ch.assertExchange(BusEventos.EXCHANGE, 'topic', { durable: true });
      for (const c of this.consumidores) await this.enlazar(c.nombre, c.fn);
      logJson('info', 'bus_eventos_rabbitmq', { exchange: BusEventos.EXCHANGE, colas: this.consumidores.map((c) => c.nombre) });
    } catch (err) {
      this.ch = undefined;
      logJson('warn', 'bus_eventos_rabbitmq_no_disponible', { error: (err as Error).message });
    }
  }

  async onModuleDestroy(): Promise<void> {
    try { await this.cerrar?.(); } catch { /* ya cerrado */ }
  }

  /** Registra un consumidor. `nombre` identifica su cola en RabbitMQ (una cola por consumidor). */
  suscribir(c: Consumidor, nombre = `consumidor-${this.consumidores.length + 1}`): void {
    this.consumidores.push({ nombre, fn: c });
    if (this.ch) void this.enlazar(nombre, c);
  }

  async publicar(evento: EventoNegocio): Promise<void> {
    if (this.ch) {
      // Si falla, el error sube al job y el evento sigue sin marcar como publicado en el outbox.
      this.ch.publish(BusEventos.EXCHANGE, evento.tipo, Buffer.from(JSON.stringify(evento)), {
        persistent: true,
        messageId: String(evento.id),
        correlationId: evento.correlacion_id,
        contentType: 'application/json',
      });
      return;
    }
    for (const c of this.consumidores) await c.fn(evento);
  }

  private async enlazar(nombre: string, fn: Consumidor): Promise<void> {
    const ch = this.ch!;
    const cola = `posada.${nombre}`;
    await ch.assertQueue(cola, { durable: true });
    await ch.bindQueue(cola, BusEventos.EXCHANGE, '#');
    await ch.consume(cola, async (m) => {
      if (!m) return;
      try {
        const e = JSON.parse(m.content.toString()) as EventoNegocio;
        await fn(e);
        ch.ack(m);
      } catch (err) {
        logJson('error', 'bus_consumidor_error', { cola, error: (err as Error).message });
        ch.nack(m, false, !m.fields.redelivered); // un solo reintento; luego se descarta
      }
    });
  }
}

/** Consumidor de auditoría idempotente: procesa cada evento una sola vez aunque se reentregue. */
@Injectable()
export class AuditoriaConsumidor {
  private readonly vistos = new Set<number>();
  private static readonly MAX = 10_000;

  constructor(bus: BusEventos) {
    bus.suscribir((e) => this.manejar(e), 'auditoria');
  }

  manejar(e: EventoNegocio): void {
    if (this.vistos.has(e.id)) return; // entrega duplicada: se ignora
    if (this.vistos.size >= AuditoriaConsumidor.MAX) this.vistos.clear();
    this.vistos.add(e.id);
    // Solo identificadores: el payload puede tener datos personales
    logJson('info', 'auditoria_evento', { evento_id: e.id, tipo: e.tipo, agregado: e.agregado, correlacion_id: e.correlacion_id });
  }
}
