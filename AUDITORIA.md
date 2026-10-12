# Auditoría de accesibilidad, UX, seguridad y calidad — Frontend y Backend — Posada EC

> **Contenido:** **Parte A** = frontend (accesibilidad WCAG 2.2 AA, UX y responsive; auditoría del 2026-10-06, sin cambios). **Parte B** = backend, API, base de datos, despliegue y dependencias (2026-10-11, al final del documento).

# PARTE A — Auditoría del frontend (accesibilidad, UX y diseño responsive)

**Fecha:** 2026-10-06
**Método:** auditoría **no destructiva** (no se modificó ningún archivo del proyecto). Revisión estática de código, cálculo de contrastes según WCAG 2.x, y `npm run lint` (angular-eslint con reglas `templateAccessibility`).
**Alcance solicitado:** `index.html`, `styles.css`, `script.js`.

> **Nota de alcance importante:** en el repositorio **no existe `script.js`**. El `index.html` únicamente arranca Angular (`<app-root>`, `frontend/src/index.html`) y `angular.json` declara `"scripts": []`. Por lo tanto:
> - El JS/TS real vive en `frontend/src/main.ts` (bootstrap) y en los componentes/servicios Angular.
> - Como `index.html` no contiene marcado de interfaz, la verificación de estructura semántica, encabezados, ARIA, imágenes, foco, etc. se hizo sobre **las plantillas de los componentes Angular** que producen el DOM real (se indican con `archivo:línea`).
> - No se ejecutó una compilación ni un navegador real (para no generar/alterar artefactos). Los puntos que dependen del DOM renderizado se marcan como **“a verificar en DOM/navegador”**.

---

## 1. Resumen ejecutivo

El proyecto tiene una **base de accesibilidad muy sólida**: `lang="es"`, `title` por ruta, enlace “Saltar al contenido”, landmarks (`header/nav/main/footer`), foco visible global (`:focus-visible`), formularios con `label for/id`, `aria-describedby`, `aria-invalid`, `fieldset/legend`, mensajes con `role="alert"`, diálogos nativos `<dialog>` accesibles, `aria-live`/`role="status"`, respeto a `prefers-reduced-motion`, objetivos táctiles ≥ 24 px y `npm run lint` **sin errores** (incluye reglas de accesibilidad de plantillas).

No se identifican **hallazgos críticos** justificables con el código. Sí hay **2 hallazgos altos**, **6 medios** y varios **bajos** (varios de ellos buenas prácticas/UX, no incumplimientos estrictos de WCAG 2.2 AA).

| Severidad | Nº | Resumen |
|---|---|---|
| Crítico | 0 | — |
| Alto | 2 | Contraste de `--c-suave` sobre fondo (1.4.3); posible anulación de `autocomplete` por directiva (1.3.5) |
| Medio | 6 | `aria-label` en `<span>` de estrellas; contraste de estrellas; ruta sin `h1`; patrón de pestañas incompleto; `overflow-x: clip`; contraste del banner |
| Bajo | 14 | Foco de skip link, menú móvil, foco en SPA, enlaces-tarjeta verbosos, `scope`/`caption` en tablas, etc. |

**Comandos ejecutados (no destructivos):** `npm run lint` → *All files pass linting*. No se ejecutó build/test/análisis de navegador.

---

## 2. Hallazgos por severidad

### 2.1 Críticos

Ninguno. No se encontró ningún incumplimiento que bloquee el uso de la aplicación con teclado o lector de pantalla.

---

### 2.2 Altos

#### A1 — Contraste insuficiente de texto secundario sobre el fondo de la app (WCAG 1.4.3 AA)

**Evidencia (archivo:elemento):**
- Token: `frontend/src/styles.css:39` → `--c-suave: var(--gris-500)`; `:root` → `--gris-500: #6b7774` (`styles.css:18`).
- Fondo de la app: `styles.css:78` → `body { background: var(--c-fondo) }` y `styles.css:36` → `--c-fondo: var(--gris-100)` (`#f3f5f4`).
- Elementos con ese color sin superficie blanca detrás:
  - `busqueda.component.ts:150` → `<p>{{ resumenResultados() }}</p>` bajo `.resultados-cabecera` (`styles.css:239` → `color: var(--c-suave)`), dentro de `main.contenedor`.
  - `ui.ts:31` → `<app-cargando>` (`.cargando`, `styles.css:169`), usado p. ej. en `dashboard.component.ts:56`, `observabilidad.component.ts`, etc.
  - `admin.component.ts:61` → `<p class="meta">` (`.meta`, `styles.css:179`).
  - `busqueda.component.ts:174` → `<nav class="paginacion">` (`styles.css:191`).
  - `observabilidad.component.ts:16` → `<p class="ayuda">` (`.ayuda`, `styles.css:140`).

**Cálculo verificado:** `#6b7774` sobre `#f3f5f4` = **4.25:1** (requiere ≥ 4.5:1 para texto normal). Sobre blanco da 4.65:1, por eso **solo falla cuando no hay tarjeta/superficie blanca detrás**.

**Recomendación:** oscurecer `--c-suave` (p. ej. a `--gris-700` `#44514e`, ≈ 7.6:1 sobre `#f3f5f4`) o reservar `--c-suave` para fondos blancos y usar otro token para el fondo gris. Alternativa: dar superficie blanca/`.tarjeta` a esos bloques.

---

#### A2 — La directiva `appFiltro` puede anular el `autocomplete` de los campos (WCAG 1.3.5 AA) — *a verificar en DOM*

**Evidencia (archivo:elemento):**
- La directiva declara `autocomplete: 'off'` como **host attribute**: `frontend/src/app/shared/entrada.ts:74-78`.
- En el bundle compilado se confirma: `hostAttrs: ["autocomplete","off"]` (revisado en `frontend/dist/frontend/browser/chunk-UQQPY4B6.js`).
- Campos que declaran **a la vez** `appFiltro` y un `autocomplete` significativo:
  - `perfil.component.ts:36` → `appFiltro="nombre"` + `autocomplete="given-name"`.
  - `perfil.component.ts:42` → `appFiltro="nombre"` + `autocomplete="family-name"`.
  - `registro.component.ts:30` → `given-name`; `registro.component.ts:36` → `family-name`.
  - `reserva.component.ts:87` → `autocomplete="organization"` (razón social).
  - `reserva.component.ts:95` → `given-name`; `reserva.component.ts:101` → `family-name`.

**Análisis:** el host binding del directive y el atributo de plantilla compiten por el mismo atributo en el mismo `<input>`. En Angular el host binding de la directiva se aplica sobre el elemento, de modo que el valor probablemente queda en `off`. Como el `autocomplete` correcto existe en el resto de campos (`login.component.ts:20`, `reserva.component.ts:109`, tarjeta `cc-number`, etc.), la inconsistencia es real. **Confirmar en DevTools** (ver §5).

**Recomendación:** quitar `autocomplete: 'off'` del host de `FiltroDirective` (dejarlo en los pocos campos que realmente lo necesiten) o condicionarlo; conservar `given-name`/`family-name`/`organization`. Para teléfono, `TelefonoDirective` ya expone `autocomplete: 'tel'` sin conflicto (`telefono.directive.ts:12`).

---

### 2.3 Medios

#### M1 — `aria-label` sobre `<span>` genérico: las estrellas no se anuncian (WCAG 1.3.1 / 4.1.2)

**Evidencia:** `frontend/src/app/shared/ui.ts:47` →
`<span class="estrellas" [attr.aria-label]="v + ' estrellas'">{{ '★'.repeat(v) }}</span>`. El `aria-label` sobre un elemento de rol genérico (`span`) **no se expone de forma fiable** en muchos lectores (se ignora), y el contenido `★★★★★` no aporta información a AT. Se usa en `busqueda.component.ts:163` y `detalle.component.ts:38` (dentro del `h1`), donde las estrellas son la **única** representación de la categoría.
En contraste, `CalificacionComponent` sí lo hace bien: `calificacion.ts:9` usa `role="img"` + `aria-label`.

**Recomendación:** en `ui.ts:47` añadir `role="img"` (o sustituir por texto `sr-only`), igual que en `calificacion.ts:9`.

---

#### M2 — Contraste de las estrellas `#d89b1d` (WCAG 1.4.11 / 1.4.3)

**Evidencia:** `styles.css:48` → `--c-estrellas: #d89b1d`; usada en `.estrellas` (`styles.css:173`) y `.estrella.llena` (`styles.css:481`). Sobre blanco el contraste es **≈ 2.43:1**.
En `app-estrellas` las estrellas son el único indicador visual de la categoría (`busqueda.component.ts:163`, `detalle.component.ts:38`) → no alcanza 3:1 (gráfico) ni 4.5:1 (texto). En `app-calificacion` el valor numérico acompaña, por lo que ahí el riesgo es menor.

**Recomendación:** oscurecer el token (p. ej. `#8a6100` ≈ 5.3:1 sobre blanco) o mantener el color actual solo cuando haya refuerzo textual.

---

#### M3 — La ruta `/observabilidad` no tiene `<h1>` (jerarquía de encabezados; WCAG 1.3.1 / 2.4.6)

**Evidencia:** `app.routes.ts:47-50` carga `ObservabilidadComponent` como página independiente; en `observabilidad.component.ts:14-15` el primer encabezado es `<h2 id="obs-titulo">`. (Integrado como pestaña de admin sí existiría el `h1` de `admin.component.ts:32`.)

**Recomendación:** el encabezado principal de esa vista debe ser `<h1>` (y numerar los siguientes como `h2`).

---

#### M4 — Patrón ARIA de pestañas incompleto (WCAG 4.1.2 + teclado)

**Evidencia:**
- `admin.component.ts:33-37`: `role="tablist"` + botones `role="tab"` **sin `aria-controls`/`id`** y el contenido del `@switch` (líneas 39+) **no** tiene `role="tabpanel"` ni `aria-labelledby`. Además no hay navegación con flechas (solo Tab+Enter).
- `mis-reservas.component.ts:40-50`: sí tiene `role="tablist"`, `role="tab"`, `aria-controls` y `role="tabpanel"`/`aria-labelledby`, pero tampoco navegación con flechas (patrón APG).

**Recomendación:** completar el patrón (tabpanel + asociación + roving tabindex + flechas Inicio/Fin) o degradar a botones “normales” con `aria-pressed`/filtro sin `role="tab"`. Como mínimo, en admin añadir `role="tabpanel"` con `aria-labelledby`.

---

#### M5 — `overflow-x: clip` oculta el desbordamiento en lugar de evitarlo (WCAG 1.4.10 / 1.4.4)

**Evidencia:** `styles.css:77` → `html, body { overflow-x: clip; }`. El banner usa sangrado completo con `margin: -2rem calc(50% - 50vw) 0` (`styles.css:198`), cálculo basado en `vw` que incluye el ancho de la barra de desplazamiento. Cualquier desbordamiento (presente o futuro) quedaría **recortado sin scroll**, pudiendo ocultar contenido a 320 px o con zoom.

**Recomendación:** verificar a 320 px y 400 % de zoom que no se recorta nada; corregir la causa (p. ej. `calc(50% - 50%)`, `100dvw`) y quitar el `clip` global, o moverlo al contenedor del banner.

---

#### M6 — Contraste del banner dependiente de la imagen (WCAG 1.4.3) — *a verificar*

**Evidencia:** `styles.css:197-207`: `.banner` con `background: var(--marca-900) var(--banner-img) ...` y overlay `background: linear-gradient(180deg, rgb(7 53 50 / 35%) 0%, ...)` (solo 35 % de opacidad arriba). El `h1` (`.banner h1`, `styles.css:204`) y `.bajada` (`styles.css:206`) son blancos con `text-shadow`. `.banner .credito` lleva `opacity: .75` (`styles.css:207`). Sobre una foto clara (cielo del Cotopaxi) el 35 % de oscurecimiento puede no bastar para 4.5:1.

**Recomendación:** subir la opacidad del overlay en la zona superior (p. ej. ≥ 60 %) o añadir un panel semitransparente detrás del texto; verificar con una herramienta de contraste sobre la imagen real.

---

### 2.4 Bajos (mejoras de UX/buenas prácticas; no todos son incumplimientos)

| # | Hallazgo | Evidencia | Recomendación |
|---|---|---|---|
| B1 | Skip link depende del navegador para mover el foco | `app.component.ts:10` y `:43` (`<main id="contenido">` sin `tabindex="-1"`) | Añadir `tabindex="-1"` a `<main>` |
| B2 | El menú móvil no se cierra con `Escape` ni gestiona foco al abrir | `app.component.ts:13-16` (solo `(click)`); abierto/cerrado con `.abierto` (`styles.css:640`) | Añadir `(keydown.escape)` y enfocar primer enlace |
| B3 | Tras navegar (SPA) no se mueve el foco al contenido (sí el scroll) | `app.config.ts:16` (`scrollPositionRestoration: 'top'`) | Enfocar el `h1`/`main` tras cada navegación |
| B4 | Enlace-tarjeta con nombre accesible verboso y `alt` redundante | `busqueda.component.ts:155-170` (el `<a>` engloba `img alt="Foto de X"`, `h2`, calificación, ciudad, precio) | Poner `alt=""` en la portada (el `h2` ya nombra) y evitar duplicar info |
| B5 | `<th>` sin `scope="col"` en tablas de admin | `admin.component.ts:64, 104, 147, 199, 239` (en `dashboard.component.ts:119,165,193` **sí** se usa `scope="col"`) | Añadir `scope="col"` |
| B6 | `aria-label` de la marca no coincide con el texto visible | `app.component.ts:12`: visible `PosadaEC` vs `aria-label="Posada EC, inicio"` (WCAG 2.5.3) | Alinear texto visible y nombre accesible |
| B7 | Foco visible anulado en encabezados que reciben foco programático | `styles.css:296` `.paso-cabecera h2:focus` y `styles.css:426` `.seccion > h2:focus` (`outline: none`), con foco por JS en `edicion-alojamiento.component.ts:273-274` y `editor-alojamiento.component.ts` | No eliminar el indicador de foco |
| B8 | `aria-label` sobre `<span>` del contador | `calificacion.ts:71` (`.contador-valor`, rol genérico) | Añadir `role="img"`/`status` o texto `sr-only` |
| B9 | `role="application"` en el mapa Leaflet | `direccion-mapa.component.ts:40` | Valorar `role="region"` (como ya se hace en `dashboard.component.ts:186`) |
| B10 | Enlaces activos del nav sin `aria-current` | `app.component.ts:17-24` (solo `routerLinkActive="activo"`) | Añadir `aria-current="page"` (2.4.8 AAA, orientación) |
| B11 | Tablas de admin sin `<caption>`; las del dashboard sí lo tienen | `admin.component.ts:63-64` vs `dashboard.component.ts:164` | Añadir `<caption class="sr-only">` |
| B12 | CSS no usado (mantenimiento) | `styles.css:384-389` (`.escala-nota*`, sin plantilla que la use) | Eliminar o documentar |
| B13 | Pestañas de `mis-reservas` sin navegación por flechas (APG) | `mis-reservas.component.ts:40-50` | Implementar flechas Inicio/Fin |
| B14 | `index.html` sin `<noscript>` | `frontend/src/index.html:1-13` | Añadir aviso de “requiere JavaScript” (progresivo) |

---

## 3. Evidencia concreta (archivo:elemento)

### 3.1 Evidencia por hallazgo

| Hallazgo | Archivo:línea / elemento |
|---|---|
| A1 contraste | `styles.css:18,39,78`; `styles.css:169,179,191,239`; `busqueda.component.ts:150,174`; `admin.component.ts:61`; `observabilidad.component.ts:16` |
| A2 autocomplete | `entrada.ts:74-78`; `perfil.component.ts:36,42`; `registro.component.ts:30,36`; `reserva.component.ts:87,95,101` |
| M1 estrellas ARIA | `ui.ts:47`; usos `busqueda.component.ts:163`, `detalle.component.ts:38` |
| M2 contraste estrellas | `styles.css:48,173,481` |
| M3 sin h1 | `observabilidad.component.ts:14-15`; `app.routes.ts:47-50` |
| M4 pestañas | `admin.component.ts:33-37`; `mis-reservas.component.ts:40-50` |
| M5 overflow | `styles.css:77,198` |
| M6 banner | `styles.css:197-207` |
| B1 skip link | `app.component.ts:10,43` |
| B2 menú móvil | `app.component.ts:13-16`; `styles.css:638-640` |
| B3 foco SPA | `app.config.ts:16` |
| B4 enlace-tarjeta | `busqueda.component.ts:155-170` |
| B5/B11 tablas admin | `admin.component.ts:63-64,104,147,199,239` |
| B6 marca | `app.component.ts:12` |
| B7 foco en encabezados | `styles.css:296,426`; `edicion-alojamiento.component.ts:273-274` |
| B8 a B14 | `calificacion.ts:71`; `direccion-mapa.component.ts:40`; `app.component.ts:17-24`; `styles.css:384-389`; `mis-reservas.component.ts:40-50`; `index.html:1-13` |

### 3.2 Cumplimientos verificados (criterios que pasan)

- **Idioma/título/zoom (3.1.1, 2.4.2, 1.4.4):** `index.html:2` `lang="es"`; `index.html:5` `<title>`; `index.html:6` viewport **sin** `maximum-scale`/`user-scalable=no` (zoom permitido). Títulos por ruta en `app.routes.ts`.
- **Bypass Blocks (2.4.1):** enlace “Saltar al contenido” → `#contenido` (`app.component.ts:10,43`).
- **Landmarks/estructura (1.3.1):** `header.barra`, `nav#nav aria-label="Principal"`, `main#contenido`, `footer.pie-pagina` (`app.component.ts:11-50`).
- **Encabezados:** `h1` por página en las vistas principales (busqueda, detalle, reserva, mis-reservas, perfil, admin, login, registro, errores) — única excepción: M3.
- **Imágenes (1.1.1):** todas las `<img>` tienen `alt` (descriptivo o `alt=""`): `detalle.component.ts:47,54`, `busqueda.component.ts:157`, `mis-reservas.component.ts:58`, `secciones.ts:321`, `editor-alojamiento.component.ts:119`; con `loading="lazy"`.
- **Formularios (1.3.1, 3.3.1, 3.3.2, 1.3.5):** `label for/id` + `aria-describedby` + `aria-invalid` + `fieldset/legend` + `role="alert"` (`reserva.component.ts:64-197`, `perfil.component.ts:35-59`, `registro.component.ts`, `login.component.ts:20-27`); `inputmode`/`type` adecuados y `autocomplete` intencionado (salvo A2).
- **Botones vs enlaces (4.1.2 / semántica):** acciones = `<button type="button|submit">`; navegación = `<a routerLink>` (p. ej. `busqueda.component.ts:155`, `admin.component.ts:59`). Todos los botones declaran `type`.
- **Foco visible (2.4.7):** regla global `:focus-visible { outline: 3px solid var(--c-acento); outline-offset: 2px }` (`styles.css:85`); controles personalizados con `:has(input:focus-visible)` (`styles.css:317,389,500`); `btn-salir:focus-visible` propio (`styles.css:105`).
- **Diálogo modal (2.1.2, 3.2.x):** `<dialog>` nativo con `role="alertdialog"`, `aria-modal`, `aria-labelledby`/`aria-describedby`, cierre con `Escape`, clic en fondo y **restauración de foco** (`confirmar.ts:47-94`).
- **Estados dinámicos (4.1.3):** `role="status"`/`aria-live` en cargas y avisos (`ui.ts:31`, `observabilidad.component.ts:24`, `reserva.component.ts:151,207,238`).
- **Calificaciones interactivas (1.4.1, 2.1.1):** radios nativos en `fieldset/legend` con foco visible (`calificacion.ts:39-50`).
- **Reducción de movimiento (2.3.3):** `@media (prefers-reduced-motion: reduce)` (`styles.css:657-661`).
- **Objetivos táctiles (2.5.8):** `.btn` min-height 42px, `.btn-chico` 32px, `.btn-redondo` 34px, `.menu-btn` 38px, `.campo-boton` 30px; ninguno < 24 px (`styles.css:113,120,228,508`).
- **Responsive:** reflujo a 1 columna en `.dos-columnas`, `.viaje`, `.edicion`, `.buscador-fila` (`styles.css:613-650`); tablas en `.tabla-scroll`; miniaturas y menú lateral con scroll horizontal propio (`styles.css:187,573,626`); grid de tarjetas 1 col a ≤640 px (`styles.css:648`).
- **Runtime JS robusto:** `main.ts:5-6` captura el error de bootstrap; `ErrorHandler` global y listeners de `error`/`unhandledrejection` (`observabilidad.service.ts:322,396-404`); `localStorage`/`sessionStorage` siempre en `try/catch` (`observabilidad.service.ts:380-393`, `auth.service.ts:57-76`). No se detectan errores JS evidentes en el código revisado.
- **Lint:** `npm run lint` (angular-eslint + `templateAccessibility`) → sin errores.

---

## 4. Recomendación de corrección para cada hallazgo

| Hallazgo | Corrección propuesta |
|---|---|
| A1 | `styles.css:39`: cambiar `--c-suave` a un gris más oscuro (p. ej. `--gris-700`) o usarlo solo sobre superficies blancas. Recalcular con herramienta. |
| A2 | `entrada.ts:77`: eliminar `autocomplete: 'off'` del host (o condicionarlo) y validar que los campos conservan `given-name`/`family-name`/`organization`. |
| M1 | `ui.ts:47`: añadir `role="img"` al `<span class="estrellas">` (o texto `sr-only`). |
| M2 | `styles.css:48`: oscurecer `--c-estrellas` (p. ej. `#8a6100`). |
| M3 | `observabilidad.component.ts:15`: usar `<h1>` como encabezado principal. |
| M4 | `admin.component.ts:33-37` y `mis-reservas.component.ts:40-50`: completar `role="tabpanel"` + `aria-controls`/`aria-labelledby` y navegación por flechas. |
| M5 | `styles.css:77`: quitar `overflow-x: clip` y corregir el sangrado del banner (`styles.css:198`). |
| M6 | `styles.css:200-201`: reforzar el overlay del banner (≥ 60 % arriba) o añadir panel semitransparente. |
| B1 | `app.component.ts:43`: añadir `tabindex="-1"` a `main#contenido`. |
| B2 | `app.component.ts:13-16`: añadir `(keydown.escape)` y gestión de foco al abrir el menú. |
| B3 | `app.config.ts:16`: enfocar `h1`/`main` tras cada navegación. |
| B4 | `busqueda.component.ts:157`: poner `alt=""` en la portada dentro del enlace-tarjeta. |
| B5 | `admin.component.ts`: añadir `scope="col"` a los `<th>`. |
| B6 | `app.component.ts:12`: alinear el texto visible con el `aria-label`. |
| B7 | `styles.css:296,426`: no eliminar el indicador de foco. |
| B8 | `calificacion.ts:71`: añadir `role="img"`/`status` o texto `sr-only`. |
| B9 | `direccion-mapa.component.ts:40`: valorar `role="region"`. |
| B10 | `app.component.ts:17-24`: añadir `aria-current="page"` a los enlaces activos. |
| B11 | `admin.component.ts:63-64`: añadir `<caption class="sr-only">`. |
| B12 | `styles.css:384-389`: eliminar el CSS `.escala-nota*` no usado. |
| B13 | `mis-reservas.component.ts:40-50`: implementar navegación por flechas (Inicio/Fin). |
| B14 | `index.html:1-13`: añadir `<noscript>` con aviso. |

---

## 5. Pruebas que deberían repetirse tras corregir

**Automatizadas**
1. `npm run lint` (debe seguir en “All files pass linting”; incluye reglas a11y de plantillas).
2. Análisis estático en navegador con axe DevTools (o Lighthouse/Pa11y) en: `/`, `/alojamientos/:id`, `/reservar`, `/mis-reservas`, `/perfil`, `/admin`, `/observabilidad`, `/login`, `/registro`, `/no-encontrado`.

**Manuales de teclado (2.1.1, 2.4.3, 2.4.7)**
3. Recorrer cada pantalla solo con **Tab/Shift+Tab/Enter/Espacio/Esc**; confirmar orden lógico y foco visible (incl. estrellas, tarjetas-radio, pestañas, menú móvil, diálogo).
4. Activar “Saltar al contenido” y comprobar que el foco entra en `#contenido` (B1).
5. Confirmar `Escape` cierra el menú móvil y el diálogo de confirmación (B2).

**Contraste (1.4.3, 1.4.11)**
6. Medir `--c-suave` sobre `#f3f5f4` y `#ffffff`; estrellas `#d89b1d` sobre blanco (A1, M2).
7. Medir el texto del banner sobre la imagen real del Cotopaxi, arriba y abajo (M6).

**Autocompletado (1.3.5)**
8. Inspeccionar en DevTools el atributo `autocomplete` final de los campos de nombre/razón social (A2). Debe ser `given-name`/`family-name`/`organization`, no `off`.

**Responsive / reflujo (1.4.10, 1.4.4, 2.5.8)**
9. Probar a **320 px, 390 px, 768 px y escritorio** comprobando ausencia de scroll horizontal real y que **nada quede recortado** (ojo con `overflow-x: clip`): buscador, tarjetas, tablas, editor por secciones, calendario, miniaturas, banner.
9b. Con zoom de navegador al **400 %** a 1280 px de ancho, verificar que no aparece scroll horizontal ni contenido cortado.
9c. Recorrer zonas táctiles (`.btn-chico`, iconos, pestañas) a 320 px.

**Lector de pantalla**
10. Anuncio de estrellas de categoría en tarjetas y detalle (M1); encabezados de la ruta `/observabilidad` (M3); pestañas de admin (M4); restauración de foco del diálogo.

**Regresión funcional (sin relación directa con a11y pero afectada por los cambios)**
9. `npm test` y `npm run build` deben seguir pasando tras las correcciones.

---

### Conclusión
El proyecto cumple la mayor parte de WCAG 2.2 AA y destaca en formularios, foco, diálogos y semántica de acciones. Las acciones de mayor impacto son **A1 (contraste del texto secundario)** y **A2 (autocomplete)**, seguidas de **M1/M2 (estrellas)** y **M3 (h1 de observabilidad)**. El resto son mejoras de UX/robustez.

---

### Estado de corrección de la Parte A (revisado en código el 2026-10-11)

> Los hallazgos de esta parte se redactaron el 2026-10-06; al revisar el código el 2026-10-11 casi todos ya estaban aplicados. Las evidencias de arriba (archivo:línea) describen el estado **de esa fecha**.

| Hallazgo | Estado | Cómo quedó |
|---|---|---|
| A1 contraste `--c-suave` | Corregido | `--c-suave: #616d6a` → 4.91:1 sobre el fondo y 5.38:1 sobre blanco (calculado) |
| A2 `autocomplete` anulado | Corregido | `entrada.ts`: el host ya no fuerza `off`; respeta el `autocomplete` del campo |
| M1 estrellas sin rol | Corregido | `ui.ts`: `role="img"` + `aria-label` ("1 estrella"/"N estrellas") |
| M2 contraste estrellas | Corregido | `--c-estrellas: #b58015` → 3.46:1 sobre blanco (≥ 3:1 para gráficos) |
| M3 `/observabilidad` sin `h1` | Corregido | `h1` cuando es página propia, `h2` cuando va dentro de Admin |
| M4 pestañas ARIA | Corregido | Admin y Mis reservas: `aria-controls`, `role="tabpanel"`, `aria-labelledby`, roving tabindex y teclado (`teclaPestana`) |
| M5 `overflow-x: clip` | Corregido | Se quitó el `clip` global; el banner usa `margin-inline: calc(50% - 50cqi)` (ancho útil, sin `vw`). **Falta probar a 320 px y 400 % de zoom en el navegador.** |
| M6 contraste del banner | Corregido (a verificar visualmente) | Overlay subido de 35 % a 66–72 % de opacidad |
| B1 `main` sin `tabindex` | Corregido | `<main id="contenido" tabindex="-1">` |
| B2 menú móvil y Escape | Corregido | `(keydown.escape)` cierra y devuelve el foco al botón |
| B3 foco tras navegar | **Corregido hoy** | `app.component.ts`: al cambiar de ruta (no de parámetros) se enfoca `#contenido`; `#contenido:focus { outline: none }` |
| B4 `alt` redundante | Corregido | Portada con `alt=""` |
| B5 `scope="col"` | Corregido | 5/5 `<th>` de admin |
| B6 nombre accesible de la marca | **Corregido hoy** | `aria-label="PosadaEC, inicio"` (contiene el texto visible) |
| B7 foco anulado en `h2` | Corregido | Ya no existe `outline: none` en esos encabezados |
| B8 contador | Corregido | Texto `sr-only` junto al valor y `aria-live` |
| B9 `role="application"` en mapa | **Corregido hoy** | `role="region"` con el mismo `aria-label` |
| B10 `aria-current` | Corregido | `ariaCurrentWhenActive="page"` |
| B11 `<caption>` | Corregido | 5/5 tablas de admin |
| B12 CSS sin uso | Corregido | `.escala-nota*` ya no existe |
| B13 flechas en pestañas de Mis reservas | Corregido | `teclaPestana` |
| B14 `<noscript>` | Corregido | `index.html:16` ya incluye el aviso de JavaScript |

**Verificación del frontend:** `ng lint` sin errores y `ngc` sin errores de compilación. **No se ejecutaron `ng test` ni `ng build` completos** (no hay Chrome en el entorno de trabajo); los corre el CI en cada push.

---
---

# PARTE B — Auditoría del backend, API, base de datos y despliegue

**Fecha:** 2026-10-11
**Método:** auditoría **no destructiva** (no se ejecutó ningún ataque ni se tocó producción). Revisión estática de código y configuración (`backend/src`, `database/*.sql`, `render.yaml`, `docker-compose.yml`, `frontend/vercel.json`, `.gitignore`, `package.json`) y contraste con los controles OWASP descritos en `docs/DOCUMENTO_TECNICO.md`. Las pruebas automáticas (`npm test` 35/35 y `npm run contract:check` 17/17) se ejecutaron en la sesión de trabajo anterior; **en esta revisión no se volvió a correr `npm audit`**: las cifras de dependencias salen de `docs/DOCUMENTO_TECNICO.md` (2026-10-05).
**Alcance:** API NestJS 10 (`api/v1`), autenticación/autorización, validación, base de datos Supabase (esquema `booking`), despliegue (Render + Vercel), dependencias, calidad y pruebas.
**Convención:** los IDs del backend llevan prefijo `BE-` para no confundirse con los del frontend (A1, M1, B1…). Lo que no pude comprobar con el código se marca **“a verificar”**.

## B.1 Resumen ejecutivo

El backend tiene una **base de seguridad buena para el alcance del curso**: validación estricta de entradas, SQL parametrizado, JWT con algoritmo fijado, roles + scopes, límites de peticiones, cabeceras de seguridad, errores estandarizados (RFC 7807), idempotencia, validación del entorno al arrancar y logs sin datos sensibles. No hay **hallazgos críticos** demostrables con el código.

Los riesgos principales son de **ciclo de vida de la sesión** (un token sigue valiendo aunque el usuario se desactive o cambie de rol), de **datos demo públicos** si llegaran a producción, y de **proceso** (sin CI, pocas pruebas sobre la lógica que vive en SQL, dependencias con avisos que exigen salto de versión mayor).

| Severidad | Nº | Resumen |
|---|---|---|
| Crítico | 0 | — |
| Alto | 2 | JWT no se revalida (usuario desactivado o con rol cambiado conserva acceso hasta 30 min); cuentas demo con clave pública `Demo1234!` (incluye ADMIN) |
| Medio | 7 | Sin CI/CD; lógica SQL sin pruebas de integración; frontend sin CSP; BD con rol que omite RLS; URL de webhooks sin filtro anti-SSRF (latente); dependencias con avisos; disponibilidad (Render free + jobs en el mismo proceso) |
| Bajo | 8 | Swagger público; enumeración de correos al registrar y por tiempo en recuperación; JWT en `sessionStorage`; reset no cierra sesiones; sin bloqueo de cuenta; rate limit en memoria; credenciales dev en compose; documentación con cifras inconsistentes |

**Comandos/pruebas citados:** `npm test` → 35 pruebas OK; `npm run contract:check` → 17/17 operaciones del contrato oficial; `eslint`/`tsc` sin errores (sesión anterior).

---

## B.2 Hallazgos por severidad

### B.2.1 Críticos

Ninguno. No se encontró inyección SQL, secretos en el repositorio ni ruta sin autenticación que exponga datos privados.

---

### B.2.2 Altos

#### BE-A1 — El JWT no se revalida contra la base de datos (rol y estado “activo” quedan congelados 30 min)

**Evidencia:**
- `backend/src/common/auth/guards.ts:23` → `req.user = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] })`: solo valida firma y expiración; no consulta `usuario.activo` ni `usuario.rol`.
- `backend/src/config/entorno.ts:28` → vigencia por defecto `JWT_EXPIRES_IN = '30m'`; no hay refresh token ni lista de revocación.
- `backend/src/modules/auth/auth.service.ts:84` → `activo` solo se comprueba en el **login**.
- Relación con funciones nuevas: el admin puede desactivar usuarios y asignar rol ADMIN (`admin.service.ts`), pero el cambio **no afecta tokens ya emitidos**.

**Riesgo:** un usuario desactivado puede seguir operando (reservar, cancelar) hasta que venza su token; a un ADMIN degradado se le sigue aceptando hasta 30 min; un token robado no se puede anular. Impacto acotado por la vida corta del token. *Severidad Alta por afectar control de acceso, con probabilidad baja.*

**Recomendación:** (a) reducir a 10–15 min + refresh token rotatorio; o (b) en `JwtAuthGuard`, consultar `activo` y `rol` por petición (1 consulta por clave primaria, con caché de 30–60 s); o (c) columna `token_version` en `usuario` incluida en el claim y comparada al verificar.

---

#### BE-A2 — Cuentas demo con contraseña conocida y pública, incluida la de ADMIN

**Evidencia:**
- `database/02_datos_demo.sql:3` → “Contraseña de TODAS las cuentas demo: Demo1234!”; `:15` crea los usuarios con `crypt('Demo1234!', …)`.
- `database/02_datos_demo.sql:17` → cuenta `admin.plataforma@gmail.com` con rol `ADMIN`.
- Las credenciales aparecen también en la documentación del repositorio.

**Riesgo:** si el script de datos demo se ejecutó en la base de producción (Supabase), cualquiera que lea el repositorio puede entrar como administrador. **A verificar:** si la base desplegada contiene esos usuarios con esa clave.

**Recomendación:** tras la defensa, cambiar la clave del admin y eliminar/desactivar las cuentas demo en producción (`UPDATE usuario SET activo = false …` o cambiar `password_hash`); separar `02_datos_demo.sql` (solo desarrollo) de una carga inicial de producción que cree un admin con clave fuerte entregada por variable de entorno.

---

### B.2.3 Medios

#### BE-M1 — No hay integración continua (CI) ni verificación automática antes del despliegue
**Evidencia:** no existe `.github/`; Vercel despliega en cada push a `main` y Render según `render.yaml`. **Riesgo:** una rama con pruebas rotas, lint o `contract:check` fallido puede llegar a producción. **Recomendación:** workflow de GitHub Actions con `npm ci`, `lint`, `test`, `build` y `contract:check` en el backend, y `lint`/`test`/`build` en el frontend; proteger `main` exigiendo que pase.

#### BE-M2 — Las reglas de negocio críticas viven en SQL y no tienen pruebas automáticas
**Evidencia:** `fn_cotizar`, `fn_crear_preview`, `fn_crear_orden` (incl. `RESERVA_DUPLICADA`), `fn_cancelar_reserva` y triggers como `tg_detalle_validar` (`database/01_esquema.sql`, `03_integracion.sql`); las 35 pruebas Jest son unitarias (9 archivos `*.spec.ts`) y no tocan la BD. **Riesgo:** una regresión en disponibilidad, precios o duplicados no la detecta ninguna prueba. **Recomendación:** pruebas de integración con Postgres en contenedor (el `docker-compose.yml` ya existe) que carguen los tres scripts y verifiquen: doble reserva, solapamiento de fechas, cancelación y reembolso, idempotencia.

#### BE-M3 — El frontend no envía Content-Security-Policy ni otras cabeceras recomendadas
**Evidencia:** `frontend/vercel.json:11-13` solo define `X-Content-Type-Options`, `Referrer-Policy` y `X-Frame-Options`. **Riesgo:** sin CSP, un XSS (hoy no hay `innerHTML` ni `bypassSecurityTrust*` en `frontend/src`) tendría más alcance, y el JWT está en `sessionStorage` (BE-B4). HSTS lo aplica Vercel por defecto en HTTPS (**a verificar** con `curl -I`). **Recomendación:** añadir `Content-Security-Policy` (`default-src 'self'; connect-src 'self' https://reto1is.onrender.com; img-src 'self' https: data:; frame-ancestors 'none'`) y `Permissions-Policy`; probar en modo `Report-Only` primero.

#### BE-M4 — La API se conecta a la BD con el rol `postgres`, que omite RLS
**Evidencia:** `database/01_esquema.sql:872-882` → “El backend se conecta con el rol 'postgres', que omite RLS” (RLS activada sin políticas solo protege contra la API pública de Supabase). **Riesgo:** la autorización depende 100 % del código del backend; un bug de autorización o una inyección tendría acceso total. Mitigado: todo el SQL es parametrizado (`db.service.ts`). **Recomendación:** crear un rol `app_backend` con permisos mínimos (SELECT/INSERT/UPDATE/EXECUTE solo sobre lo necesario, sin DDL) y usarlo en `DATABASE_URL`.

#### BE-M5 — URL de webhooks sin filtro anti-SSRF (riesgo latente)
**Evidencia:** `backend/src/modules/alojamientos/dto/ordenes.dto.ts:138` valida `@IsUrl({ protocols: ['https'], require_tld: true })` y `webhooks.service.ts:32` solo la **guarda**; en el código revisado **no hay envío HTTP saliente** (la entrega es simulada en `webhook_entrega`). **Riesgo:** si en el futuro se implementa la entrega real, una URL a un host interno resuelto por DNS, o una redirección, permitiría SSRF. **Recomendación:** al implementar el envío, resolver DNS y bloquear IPs privadas/loopback/link-local, no seguir redirecciones, poner timeout y tamaño máximo, y firmar con el secreto (HMAC) ya almacenado.

#### BE-M6 — Dependencias con avisos de seguridad (arreglo con salto de versión mayor)
**Evidencia:** `docs/DOCUMENTO_TECNICO.md:287-298` → `npm audit --omit=dev`: backend 15 (0 críticos, 4 altos), frontend 7 (4 altos); 12 de los 15 del backend y los 7 del frontend requieren NestJS 10→11/12 y Angular 19→21; 3 del backend (`@nestjs/common`, `qs`, `file-type`) se corrigen sin salto mayor y están pendientes. **Riesgo:** vulnerabilidades conocidas en librerías de ejecución; el propio documento reconoce que no se aplicó `audit fix`. **Recomendación:** ejecutar ya `npm audit fix` (sin `--force`) en el backend + build + `contract:check`; planificar la migración mayor como tarea posterior; activar Dependabot.

#### BE-M7 — Disponibilidad: plan gratuito de Render y trabajos en el mismo proceso
**Evidencia:** `render.yaml` (plan free: se duerme por inactividad → primera petición lenta); los jobs (outbox cada 5 s, `@nestjs/schedule`) y el bus de eventos corren **dentro del proceso web** (`modules/jobs/bus-eventos.ts`, en memoria). **Riesgo:** latencia de arranque en frío; al reiniciarse se pierde el estado del bus (el outbox en BD sí conserva los eventos, por eso no se pierden datos); con 2+ instancias los jobs se duplicarían (mitigado por `FOR UPDATE SKIP LOCKED`). **Recomendación:** plan de pago o *keep-alive* externo para la demo; para producción, worker separado y broker real (diseño ya descrito en el documento técnico).

---

### B.2.4 Bajos

| # | Hallazgo | Evidencia | Riesgo | Recomendación |
|---|---|---|---|---|
| BE-B1 | Swagger (`/api/docs`) público en producción | `backend/src/main.ts:37` → `montarSwagger(app)` sin condición; `swagger.ts:54` | Facilita el reconocimiento de la superficie de la API (no expone datos) | Mantenerlo (es parte de la entrega) o protegerlo/ocultarlo tras la defensa |
| BE-B2 | El registro revela si un correo existe (409) | `auth.service.ts:55-58` (`MENSAJE_EMAIL_DUPLICADO`); el login, en cambio, es genérico (`:81-84`, con hash señuelo) | Enumeración de usuarios | Aceptable por UX; mitigado por límite 5/min (`auth.controller.ts:13`); alternativa: respuesta neutra + correo de verificación |
| BE-B3 | Recuperar clave responde igual pero con distinto tiempo si el correo no existe | `auth.service.ts:92` (`if (!fila) return {}` sin hacer el INSERT) | Enumeración por temporización | Ejecutar un trabajo equivalente o encolar el envío de forma asíncrona |
| BE-B4 | JWT guardado en `sessionStorage` | `frontend/src/app/core/services/auth.service.ts:10,60` | Un XSS podría leerlo (hoy no hay `innerHTML`/`bypassSecurityTrust*`; Angular escapa por defecto) | Cookie `HttpOnly; Secure; SameSite` o CSP estricta (ver BE-M3) |
| BE-B5 | Restablecer clave no invalida sesiones ya emitidas | `auth.service.ts:104-120` solo cambia `password_hash` | Un token robado sigue valiendo tras cambiar la clave | Resolver junto con BE-A1 (`token_version`) |
| BE-B6 | Sin bloqueo de cuenta por intentos fallidos; rate limit en memoria por instancia | `app.module.ts:28` (100/min global), `auth.controller.ts:13` (5/min por IP); política de clave de 8 caracteres (`auth.dto.ts:9-11`) | Fuerza bruta distribuida; contadores no compartidos si se escala | Almacén compartido (Redis) y bloqueo temporal por cuenta; subir mínimo de clave |
| BE-B7 | Credenciales de desarrollo en `docker-compose.yml` | `postgres/postgres` (solo local; la producción usa Supabase) | Ninguno si no se expone el puerto | Mantener solo para desarrollo; no publicar el puerto 5432 en redes compartidas |
| BE-B8 | Cifras inconsistentes en la documentación | `docs/DOCUMENTO_TECNICO.md:289-296` (15 backend / 7 frontend) vs `:466` (“40 altos; frontend 2 críticos, 26 altos”); 25 vs 27 tablas; conteos de pruebas antiguos | Pérdida de credibilidad en la defensa | Unificar con una sola corrida de `npm audit` fechada |

---

## B.3 Evidencia de controles que sí cumplen (verificados en código)

| Control | Evidencia |
|---|---|
| Cabeceras de seguridad en la API (helmet; HSTS solo en producción; CORP same-site) | `backend/src/main.ts:17-23` |
| Límite de tamaño del cuerpo (100 kb) | `main.ts:24` |
| CORS con lista explícita de orígenes | `main.ts:27-28`, `config/entorno.ts` (`origenesCors`) |
| Validación global: `whitelist`, `forbidNonWhitelisted`, `transform` | `common/validation/validation.ts` |
| Orden de guards: Throttler → JWT → Roles → Scopes; `@Public` solo en rutas explícitas | `app.module.ts:42-45`, `common/auth/guards.ts` |
| JWT con algoritmo fijado (HS256) | `guards.ts:23`, `common.module.ts:15` |
| Contraseñas con bcrypt costo 12 y comparación con hash señuelo (sin filtrar si el correo existe) | `auth.service.ts:14,59,81`, `admin.service.ts:93` |
| Tokens de recuperación: 32 bytes aleatorios, solo se guarda SHA-256, un solo uso, 30 min, transacción con `FOR UPDATE` | `auth.service.ts:94-118` |
| SQL parametrizado (`$1…`) en todos los servicios revisados | `db.service.ts`, `host.service.ts`, `cuenta.service.ts` |
| Autorización por propietario: el anfitrión solo ve lo suyo (`anfitrion_id = $1`; el ADMIN ve todo); el huésped solo sus reservas | `host.service.ts:86,96,255,308,321,330`; `cuenta.service.ts:107-114` |
| Rutas de administración protegidas con `@Roles('ADMIN')` | `modules/admin/admin.controller.ts:23`; `modules/host/host.controller.ts:25` (incluye `confirm-payment`) |
| Límite estricto de 5/min en login, registro y recuperación | `auth.controller.ts:13,22,31,48,57` |
| Fallo al arrancar si faltan `DATABASE_URL`, `JWT_SECRET` (≥ 32) o `CORS_ORIGINS` en producción; redirección a HTTPS; `trust proxy` | `config/entorno.ts`, `main.ts:15,17` |
| Idempotencia en operaciones de dinero/reserva | `common/guards/idempotency-key.guard.ts`, tabla `idempotencia` |
| Regla anti-duplicado de reservas (mismo huésped, misma unidad, fechas solapadas) | `database/03_integracion.sql` (`RESERVA_DUPLICADA`) + mapeo en `common/problem/postgres-errors.ts` (con prueba) |
| Errores estandarizados RFC 7807 sin trazas ni SQL al cliente | `common/problem/problem-details.filter.ts` |
| Logs JSON con correlación, sin cuerpos, claves ni tokens; correo enmascarado en auditoría de accesos | `DOCUMENTO_TECNICO.md` §OWASP A09 + `common/logging` |
| RLS activada en todas las tablas del esquema | `01_esquema.sql:872-882`, `03_integracion.sql:247-251` |
| Secretos fuera del repositorio (`.env` ignorado; `.env.example` sin valores reales) | `.gitignore`, `backend/.env.example` |
| Cabeceras básicas en el frontend (nosniff, Referrer-Policy, X-Frame-Options DENY) | `frontend/vercel.json:11-13` |
| Contrato oficial intacto y verificado (17/17) | `backend/contracts/alojamientos-openapi.yaml`, `npm run contract:check` |

## B.4 Recomendaciones priorizadas

1. **Antes de la siguiente entrega (rápido, bajo riesgo):** cambiar/desactivar las cuentas demo en producción (BE-A2); `npm audit fix` sin `--force` + build + `contract:check` (BE-M6); añadir CSP en modo `Report-Only` (BE-M3); unificar cifras del documento (BE-B8).
2. **Corto plazo:** revalidar `activo`/`rol` en el guard o `token_version` (BE-A1, BE-B5); workflow de CI (BE-M1); rol de BD con permisos mínimos (BE-M4).
3. **Mediano plazo:** pruebas de integración con Postgres (BE-M2); cuando se implemente el envío real de webhooks, filtro anti-SSRF (BE-M5); migración NestJS 11/12 y Angular 21 (BE-M6); worker y broker separados (BE-M7).

## B.5 Pruebas que deberían repetirse tras corregir

```bash
# Backend
cd backend && npm ci && npm run lint && npm test && npm run build && npm run contract:check
npm audit --omit=dev            # esperado: bajan los avisos tras audit fix

# Sesión (BE-A1): desactivar un usuario y reutilizar su token → debe responder 401
curl -H "Authorization: Bearer <token_de_usuario_desactivado>" https://reto1is.onrender.com/api/v1/me

# Cabeceras (BE-M3)
curl -I https://<dominio-vercel>/            # debe incluir Content-Security-Policy y Strict-Transport-Security

# Límite de intentos
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code}\n" -X POST .../api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"x@x.com","password":"mala"}'; done   # el 6.º → 429

# Secretos en el historial
git log --all -S "JWT_SECRET=" --oneline
```
Además: probar manualmente que un huésped no ve reservas de otro (`GET /orders/{id}` ajeno → 403/404) y que `PATCH /admin/users/:id/role` responde 403 con un token de USUARIO.

---

## B.6 Estado de corrección de la Parte B (2026-10-11)

| Hallazgo | Estado | Qué se hizo / qué falta |
|---|---|---|
| BE-A1 JWT sin revalidar | **Corregido** | `guards.ts`: tras verificar la firma consulta `usuario.activo` y `rol` (caché 10 s). Cuenta inactiva o inexistente → 401; rol y scopes salen de la BD. 6 pruebas nuevas (`guards.spec.ts`) |
| BE-A2 cuentas demo públicas | **Script listo, falta ejecutarlo tú** | `database/produccion_asegurar_cuentas_demo.sql` cambia la clave del admin y aleatoriza las demás. Ejecutarlo en Supabase **después de la defensa** (reemplazando la clave de ejemplo; no la subas a git) |
| BE-M1 sin CI | **Corregido** | `.github/workflows/ci.yml` (lint, test, build, contract:check; y lint, test y build en el frontend). Para que bloquee despliegues, proteger `main` en GitHub exigiendo estos checks |
| BE-M2 SQL sin pruebas de integración | Pendiente | Requiere montar Postgres en CI; se deja como mejora |
| BE-M3 frontend sin CSP | **Corregido en parte** | `vercel.json`: HSTS, Permissions-Policy y `Content-Security-Policy-Report-Only`. La CSP es solo de **reporte** a propósito (Angular puede inyectar estilos/handlers en línea): revisar la consola del navegador y, si no hay violaciones, cambiarla a `Content-Security-Policy` |
| BE-M4 rol `postgres` | **Script listo, falta aplicarlo tú** | `database/endurecer_rol_backend.sql` (rol `app_backend` con permisos mínimos y política RLS propia). **No probado contra Supabase real**: probar primero en un proyecto de pruebas y luego cambiar `DATABASE_URL` en Render |
| BE-M5 SSRF en webhooks | **Corregido (validación de la URL)** | `common/validation/url-publica.ts` + `@UrlPublicaHttps()` en `WebhookSubscriptionDto`: rechaza IP, localhost, nombres internos y credenciales (`url-publica.spec.ts`, 19 casos). Al implementar el envío real hay que validar también la IP resuelta por DNS |
| BE-M6 dependencias | **Parcial** | Se añadió Dependabot (`.github/dependabot.yml`). `npm audit fix` **no se aplicó**: en el entorno de trabajo reescribía el `package-lock.json` en más de 20 000 líneas; correrlo en tu máquina (sin `--force`), con `npm test`, `npm run build` y `npm run contract:check`. La migración NestJS 11/12 y Angular 21 sigue pendiente |
| BE-M7 disponibilidad | Aceptado | Limitación del plan gratuito de Render; documentado |
| BE-B1 Swagger público | Aceptado | Parte de la entrega |
| BE-B2 enumeración al registrar | Aceptado | Compromiso de UX, con límite de 5/min |
| BE-B3 temporización en recuperar clave | **Corregido** | `auth.service.ts`: mismo trabajo (token + consulta) cuando el correo no existe |
| BE-B4 JWT en `sessionStorage` | Aceptado | Mitigado: sin `innerHTML`/`bypassSecurityTrust*`; CSP en reporte |
| BE-B5 reset no cierra sesiones | Parcial | Con BE-A1 una cuenta desactivada pierde acceso; invalidar tokens al cambiar la clave requiere una columna nueva (`token_version`) |
| BE-B6 bloqueo de cuenta / rate limit compartido | Pendiente | Requiere Redis o columna de intentos |
| BE-B7 credenciales de `docker-compose.yml` | Aceptado | Solo desarrollo |
| BE-B8 documentación inconsistente | **Corregido** | `DOCUMENTO_TECNICO.md`: conteo de pruebas (backend 60, frontend 62) y cifras de `npm audit` aclaradas; se añadió el anexo de correcciones |

**Verificación del backend (2026-10-11):** `tsc --noEmit` y `eslint` sin errores; `npm test` → 11 suites, **60 pruebas OK** (antes 35); `contract:check` → **17/17**. No se ejecutó contra una base de datos real ni se desplegó.

---

# Conclusión general

**Frontend (Parte A):** base de accesibilidad sólida, sin críticos; 2 altos, 6 medios y 14 bajos, mayormente de contraste y ARIA.

**Backend (Parte B):** controles de seguridad bien aplicados en validación, autenticación, autorización por propietario, SQL parametrizado, límites y errores; sin críticos. Los puntos a atender son el **ciclo de vida del token** (BE-A1), las **cuentas demo públicas** (BE-A2) y el **proceso** (CI, pruebas de la lógica SQL, dependencias). Ninguno impide la defensa; sí conviene cerrarlos antes de considerar el sistema listo para uso real.

**Límites de esta auditoría:** revisión estática; no se hizo prueba de penetración, no se ejecutó la aplicación desplegada ni se re-corrió `npm audit` en esta fecha; los puntos marcados “a verificar” requieren confirmarse en el entorno real.
