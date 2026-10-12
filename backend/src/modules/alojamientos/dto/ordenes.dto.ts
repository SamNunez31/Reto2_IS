import { Type } from 'class-transformer';
import {
  ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUrl, IsUUID, Length,
  Matches, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { UrlPublicaHttps } from '../../../common/validation/url-publica';
import { NumeroDocumentoValido, Sanitizar } from '../../../common/validation/validadores-ec';
import { FECHA, HuespedesDto, MSG_FECHA } from './comunes.dto';

/** OrderPreviewRequest */
export class OrderPreviewRequestDto {
  @IsInt()
  @Min(1)
  accommodation_id: number;

  /** Identificador opaco devuelto por /availability */
  @IsString()
  @Length(10, 200)
  product_id: string;

  @ValidateNested()
  @Type(() => HuespedesDto)
  guests: HuespedesDto;
}

/** Extensión (no está en el YAML del contrato): tipo de documento para la factura. */
export enum TipoDocumentoFactura {
  CEDULA = 'CEDULA',
  RUC = 'RUC',
  PASAPORTE = 'PASAPORTE',
  CONSUMIDOR_FINAL = 'CONSUMIDOR_FINAL',
}

/** document_number válido según document_type: mismos algoritmos y mensajes que el perfil (validadores-ec.ts). */
const DocumentoFactura = () => NumeroDocumentoValido('document_type', { obligatorioSinTipo: true });

const conDocumento = (o: DatosClienteDto) => !!o.document_type && o.document_type !== TipoDocumentoFactura.CONSUMIDOR_FINAL;

export class DatosClienteDto {
  @IsOptional()
  @Sanitizar()
  @IsString()
  @MaxLength(80)
  first_name?: string;

  @IsOptional()
  @Sanitizar()
  @IsString()
  @MaxLength(80)
  last_name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'correo inválido' })
  @MaxLength(160)
  email?: string;

  /**
   * Extensión opcional (datos de la factura). Sin este campo el comportamiento es el de siempre.
   * CONSUMIDOR_FINAL no requiere más datos; CEDULA/PASAPORTE requieren nombres y apellidos; RUC requiere razón social.
   */
  @IsOptional()
  @IsEnum(TipoDocumentoFactura, { message: 'tipo de documento inválido' })
  document_type?: TipoDocumentoFactura;

  /** Extensión: número de documento (no se guarda en el perfil del usuario, solo en la factura). */
  @ValidateIf(conDocumento)
  @IsString({ message: 'ingresa el número de documento' })
  @DocumentoFactura()
  document_number?: string;

  /** Extensión: razón social (obligatoria con RUC). */
  @ValidateIf((o: DatosClienteDto) => o.document_type === TipoDocumentoFactura.RUC || o.business_name !== undefined)
  @Sanitizar()
  @IsString({ message: 'ingresa la razón social' })
  @Length(2, 160, { message: 'la razón social debe tener entre 2 y 160 caracteres' })
  business_name?: string;
}

/** Extensión (no está en el YAML del contrato): método de pago de la orden. */
export enum MetodoPago {
  CARD = 'CARD',
  CASH = 'CASH',
}

/** OrderCreateRequest */
export class OrderCreateRequestDto {
  @IsUUID()
  order_preview_id: string;

  /**
   * Extensión opcional: CARD (por defecto, tarjeta simulada) o CASH (efectivo al llegar: la reserva queda
   * CONFIRMADA y su pago PENDIENTE hasta que el admin confirma que lo recibió).
   */
  @IsOptional()
  @IsEnum(MetodoPago, { message: 'payment_method debe ser CARD o CASH' })
  payment_method?: MetodoPago;

  /**
   * Referencia del pago simulado: ^PAY-[A-Z0-9]{6,}$ (se valida en el servicio para responder PAYMENT_REFERENCE_INVALID).
   * Obligatoria con tarjeta; con efectivo no se usa.
   */
  @ValidateIf((o: OrderCreateRequestDto) => o.payment_method !== MetodoPago.CASH)
  @IsString()
  @MaxLength(60)
  payment_reference: string;

  @ValidateNested()
  @Type(() => DatosClienteDto)
  customer_details: DatosClienteDto;
}

/** OrderModifyRequest */
export class OrderModifyRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => HuespedesDto)
  guests?: HuespedesDto;

  @IsOptional()
  @Matches(FECHA, { message: MSG_FECHA })
  checkin?: string;

  @IsOptional()
  @Matches(FECHA, { message: MSG_FECHA })
  checkout?: string;
}

export enum EventoWebhook {
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
}

/** WebhookSubscription (el cliente envía el id; el secreto lo genera el servidor) */
export class WebhookSubscriptionDto {
  @IsUUID()
  id: string;

  /** Solo https */
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: true }, { message: 'url debe ser https pública' })
  @UrlPublicaHttps() // anti-SSRF: sin IP, localhost, nombres internos ni credenciales (BE-M5)
  @MaxLength(500)
  url: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(EventoWebhook, { each: true })
  events: EventoWebhook[];

  /** Se ignora en la entrada: el servidor genera un secreto de 32 bytes */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  secret?: string;
}
