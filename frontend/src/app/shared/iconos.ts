/**
 * Iconos de línea del panel: solo el atributo `d` de un <path>, para dibujarlos con un <svg> de 24×24
 * sin añadir ninguna dependencia. Se usan con `aria-hidden` y un texto accesible al lado.
 */
export const ICONOS: Record<string, string> = {
  // Secciones
  indicadores: 'M4 20V10M10 20V4M16 20v-7M21 20H3',
  alojamientos: 'M3 21V7l6-4v18M9 21h12V11H9M13 15h2M17 15h2M13 18h2M17 18h2',
  reservas: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4',
  habitaciones: 'M2 18v-6h13a4 4 0 0 1 4 4v2M2 18h20M2 12V6M6 9h5',
  ingresos: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  resenas: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  usuarios: 'M4 21v-1a6 6 0 0 1 12 0v1M10 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8M17 11a3 3 0 1 0 0-6M20 21v-1a5 5 0 0 0-3-4.6',
  catalogos: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  impuestos: 'M19 21V3H5v18l2-1.5L9 21l2-1.5L13 21l2-1.5zM9 8h6M9 12h6M9 16h3',
  eventos: 'M22 12h-4l-3 9L9 3l-3 9H2',
  jobs: 'M12 7v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18',
  observabilidad: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  // Acciones
  editar: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  ver: 'M15 3h6v6M10 14L21 3M18 13v8H3V6h8',
  publicar: 'M20 6L9 17l-5-5',
  despublicar: 'M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 4.2A10 10 0 0 1 22 12a18 18 0 0 1-3.1 4M6.1 6.1A18 18 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 3.3-.6',
  suspender: 'M10 4v16M16 4v16',
  reactivar: 'M6 4l14 8-14 8z',
  eliminar: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
  checkin: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  checkout: 'M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M16 17l5-5-5-5M21 12H9',
  limpieza: 'M19 3l-7 7M14 5l5 5M11 11l-8 8 3 3 8-8zM5 21h4',
  buscar: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20.5 20.5L16 16',
  admin: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM9 12l2 2 4-4',
  desactivar: 'M16 21v-1a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5v1M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8M17 8l5 5M22 8l-5 5',
  agregarUsuario: 'M16 21v-1a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5v1M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8M19 8v6M16 11h6',
  amenidad: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  ciudad: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  cancelar: 'M18 6L6 18M6 6l12 12',
  sincronizar: 'M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2M3 4v5h5M21 20v-5h-5',
  // Tipos de alojamiento
  hotel: 'M3 21V5h12v16M15 21h6V11h-6M6 9h2M11 9h2M6 13h2M11 13h2M6 17h2M11 17h2',
  casa: 'M3 11l9-7 9 7M5 10v11h14V10M10 21v-6h4v6',
  cabana: 'M12 3L3 21h18zM9 21v-5h6v5',
  departamento: 'M4 21V3h11v18M15 21h5V9h-5M7 7h2M11 7h2M7 11h2M11 11h2M7 15h2M11 15h2',
  hostal: 'M3 21V8l9-5 9 5v13M9 21v-6h6v6M3 12h18',
};

/** Icono del tipo de alojamiento; si no hay uno específico, se usa el de casa. */
export const iconoTipo = (tipo: string): string =>
  ICONOS[(tipo ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')] ?? ICONOS['casa'];
