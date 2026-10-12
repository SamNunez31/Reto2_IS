import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Rol, SCOPES_POR_ROL, UsuarioToken } from '../../common/auth/decorators';
import { invalido, ProblemException } from '../../common/problem/problem';
import { esEmailDuplicado, MENSAJE_EMAIL_DUPLICADO, normalizarEmail } from '../../common/validation/email';
import { DbService } from '../../database/db.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './dto/auth.dto';

const COSTO_BCRYPT = 12;
// Hash fijo para igualar el tiempo de respuesta cuando el correo no existe
const HASH_SENUELO = bcrypt.hashSync('clave-senuelo', COSTO_BCRYPT);

interface FilaUsuario {
  id: string;
  email: string;
  password_hash: string;
  nombres: string;
  apellidos: string;
  rol: Rol;
  activo: boolean;
}

/** Datos públicos del usuario (nunca incluye password_hash). */
export interface UsuarioPublico {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  rol: Rol;
  es_anfitrion: boolean;
}

export interface Sesion {
  access_token: string;
  token_type: 'Bearer';
  expires_in: string;
  scope: string;
  user: UsuarioPublico;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async registrar(dto: RegisterDto): Promise<Sesion> {
    // El DTO ya normaliza; se repite aquí por si el servicio se usa sin el ValidationPipe
    const email = String(normalizarEmail(dto.email));
    const duplicado = () => new ProblemException(409, 'VALIDATION_FAILED', MENSAJE_EMAIL_DUPLICADO, [{ name: 'email', reason: MENSAJE_EMAIL_DUPLICADO }]);
    // La BD guarda los correos en minúsculas (ck_usuario_email), así que la comparación ya es sin importar mayúsculas
    const existe = await this.db.uno(`SELECT 1 FROM usuario WHERE email = $1`, [email]);
    if (existe) throw duplicado();
    const hash = await bcrypt.hash(dto.password, COSTO_BCRYPT);
    let fila: FilaUsuario | null;
    try {
      fila = await this.db.uno<FilaUsuario>(
        `INSERT INTO usuario (email, password_hash, nombres, apellidos, telefono, tipo_documento, numero_documento)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, email, password_hash, nombres, apellidos, rol, activo`,
        [email, hash, dto.nombres, dto.apellidos, dto.telefono ?? null, dto.tipo_documento ?? null, dto.numero_documento ?? null],
      );
    } catch (e) {
      // Dos registros simultáneos con el mismo correo: el segundo choca con uq_usuario_email
      if (esEmailDuplicado(e)) throw duplicado();
      throw e;
    }
    return this.crearSesion(fila as FilaUsuario);
  }

  async login(dto: LoginDto): Promise<Sesion> {
    const fila = await this.db.uno<FilaUsuario>(
      `SELECT id, email, password_hash, nombres, apellidos, rol, activo FROM usuario WHERE email = $1`,
      [normalizarEmail(dto.email)],
    );
    const claveOk = await bcrypt.compare(dto.password, fila?.password_hash ?? HASH_SENUELO);
    // Mensaje genérico: no revela si el correo existe ni si la cuenta está desactivada
    if (!fila || !claveOk || !fila.activo) {
      throw new ProblemException(401, 'VALIDATION_FAILED', 'Correo o clave incorrectos');
    }
    return this.crearSesion(fila);
  }

  /** Siempre responde lo mismo. Fuera de producción devuelve el enlace (correo simulado). */
  async olvideClave(dto: ForgotPasswordDto): Promise<{ enlace_simulado?: string }> {
    const fila = await this.db.uno<{ id: string }>(`SELECT id FROM usuario WHERE email = $1 AND activo`, [dto.email]);
    if (!fila) {
      // Misma cantidad de trabajo (token + viaje a la BD) que si el correo existiera, para no delatarlo por el tiempo de respuesta
      this.sha256(randomBytes(32).toString('hex'));
      await this.db.query(`SELECT 1`);
      return {};
    }
    const token = randomBytes(32).toString('hex');
    await this.db.query(
      `INSERT INTO token_usuario (usuario_id, tipo, token_hash, expira_en)
       VALUES ($1, 'RECUPERAR_CLAVE', $2, now() + interval '30 minutes')`,
      [fila.id, this.sha256(token)],
    );
    if (this.config.get<string>('APP_ENV') === 'production') return {};
    return { enlace_simulado: `${this.config.get<string>('PUBLIC_WEB_URL')}/restablecer-clave?token=${token}` };
  }

  /** Token de uso único, vigente 30 min; se guarda solo su SHA-256. */
  async restablecerClave(dto: ResetPasswordDto): Promise<void> {
    const hash = await bcrypt.hash(dto.password, COSTO_BCRYPT);
    const ok = await this.db.transaccion(async (q) => {
      const tok = await q<{ id: string; usuario_id: string }>(
        `SELECT id, usuario_id FROM token_usuario
          WHERE token_hash = $1 AND tipo = 'RECUPERAR_CLAVE' AND usado_en IS NULL AND expira_en > now()
          FOR UPDATE`,
        [this.sha256(dto.token)],
      );
      if (!tok.length) return false;
      await q(`UPDATE token_usuario SET usado_en = now() WHERE id = $1`, [tok[0].id]);
      await q(`UPDATE usuario SET password_hash = $2 WHERE id = $1`, [tok[0].usuario_id, hash]);
      return true;
    });
    if (!ok) throw invalido('El enlace es inválido o expiró', [{ name: 'token', reason: 'inválido, usado o expirado' }]);
  }

  async usuarioPublico(id: string): Promise<UsuarioPublico | null> {
    return this.db.uno<UsuarioPublico>(
      `SELECT u.id, u.email, u.nombres, u.apellidos, u.rol,
              EXISTS (SELECT 1 FROM alojamiento a WHERE a.anfitrion_id = u.id) AS es_anfitrion
         FROM usuario u WHERE u.id = $1`,
      [id],
    );
  }

  private async crearSesion(fila: FilaUsuario): Promise<Sesion> {
    const scope = SCOPES_POR_ROL[fila.rol].join(' ');
    const claims: UsuarioToken = { sub: fila.id, email: fila.email, rol: fila.rol, scope };
    const access_token = await this.jwt.signAsync(claims);
    const user = (await this.usuarioPublico(fila.id)) as UsuarioPublico;
    return { access_token, token_type: 'Bearer', expires_in: this.config.get<string>('JWT_EXPIRES_IN') ?? '30m', scope, user };
  }

  private sha256(texto: string): string {
    return createHash('sha256').update(texto).digest('hex');
  }
}
