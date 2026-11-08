import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Scopes del contrato (components.securitySchemes.OAuth2Security). */
const SCOPES = {
  'alojamientos:read': 'Leer información de alojamientos, disponibilidades y reservas',
  'alojamientos:book': 'Crear y alterar reservas',
  'alojamientos:cancel': 'Cancelar reservas',
  'alojamientos:webhooks': 'Gestionar webhooks',
};

/** Una sola API y una sola Swagger: contrato de Alojamientos + rutas propias. */
export function crearDocumentoOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Posada EC · Alojamientos API')
    .setDescription(
      'Implementación del contrato "GDS Alojamientos Core API" (rutas del YAML bajo /api/v1) y rutas propias ' +
        '(auth, cuenta, anfitrión, admin). El ownerId de cada reserva se infiere del `sub` del JWT. ' +
        'OAuth2 simplificado: el token se obtiene con POST /api/v1/auth/login y se envía como Bearer.',
    )
    .setVersion('1.0.0')
    .addServer('/', 'Este servidor')
    .addTag('Búsqueda y Catálogo')
    .addTag('Disponibilidad y Precios')
    .addTag('Gestión de Órdenes (Reservas)')
    .addTag('Componentes Comunes')
    .addTag('Webhooks')
    .addTag('Autenticación', 'Ruta propia: registro, login y recuperación de clave')
    .addTag('Mi cuenta', 'Ruta propia: perfil, mis reservas, factura, trazabilidad y reseñas')
    .addTag('Catálogo (ADMIN)', 'Ruta propia: el ADMIN crea, edita, publica y despublica los alojamientos de Posada EC')
    .addTag('Administración', 'Ruta propia: panel del ADMIN')
    .addTag('Salud')
    .addOAuth2(
      {
        type: 'oauth2',
        description: 'OAuth2 del contrato. En este prototipo el token Bearer se emite en /api/v1/auth/login.',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://auth.booking-hub.com/oauth2/authorize',
            tokenUrl: 'https://auth.booking-hub.com/oauth2/token',
            scopes: SCOPES,
          },
          clientCredentials: { tokenUrl: 'https://auth.booking-hub.com/oauth2/token', scopes: SCOPES },
        },
      },
      'OAuth2Security',
    )
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function montarSwagger(app: INestApplication): void {
  // SWAGGER_ENABLED=false oculta /api/docs (recomendado en producción si no hace falta mostrar el contrato)
  if (process.env.SWAGGER_ENABLED === 'false') return;
  SwaggerModule.setup('api/docs', app, crearDocumentoOpenApi(app), {
    swaggerOptions: { persistAuthorization: true },
  });
}
