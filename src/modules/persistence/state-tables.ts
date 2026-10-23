/**
 * Mapeo canónico bidireccional entre el estado en memoria de los servicios
 * y las filas de las tablas en PostgreSQL.
 */

export interface TableDefinition {
  tableName: string;
  primaryKey: string[];
  columns: string[];
  jsonbColumns?: string[];
  arrayColumns?: string[];
}

export const TABLE_DEFINITIONS: Record<string, TableDefinition> = {
  usuarios: {
    tableName: 'usuarios',
    primaryKey: ['id'],
    columns: ['id', 'nombre', 'correo', 'telefono', 'contrasena_hash', 'rol', 'estado', 'motivo_restriccion', 'creado_en', 'extra'],
    jsonbColumns: ['extra'],
  },
  sesiones: {
    tableName: 'sesiones',
    primaryKey: ['token'],
    columns: ['token', 'usuario_id', 'correo', 'rol', 'expira_en', 'extra'],
    jsonbColumns: ['extra'],
  },
  eventos_auditoria: {
    tableName: 'eventos_auditoria',
    primaryKey: ['id'],
    columns: ['id', 'orden', 'actor', 'accion', 'entidad', 'entidad_id', 'ocurrido_en', 'resultado', 'detalle', 'extra'],
    jsonbColumns: ['extra'],
  },
  tokens_recuperacion: {
    tableName: 'tokens_recuperacion',
    primaryKey: ['hash'],
    columns: ['hash', 'correo', 'expira_en', 'usado', 'extra'],
    jsonbColumns: ['extra'],
  },
  correos_simulados: {
    tableName: 'correos_simulados',
    primaryKey: ['id'],
    columns: ['id', 'orden', 'para', 'asunto', 'cuerpo', 'token', 'expira_en', 'enviado_en', 'extra'],
    jsonbColumns: ['extra'],
  },
  solicitudes_recuperacion: {
    tableName: 'solicitudes_recuperacion',
    primaryKey: ['correo'],
    columns: ['correo', 'intentos', 'extra'],
    jsonbColumns: ['extra'],
    arrayColumns: ['intentos'],
  },
  publicaciones: {
    tableName: 'publicaciones',
    primaryKey: ['id'],
    columns: [
      'id', 'orden', 'titulo', 'descripcion', 'ciudad', 'departamento', 'direccion', 'pais', 'tipo',
      'precio_noche', 'tarifa_limpieza', 'descuento_estancia', 'capacidad', 'habitaciones', 'banos',
      'servicios', 'reglas', 'imagenes', 'completa', 'campos_faltantes', 'calificacion', 'total_resenas',
      'anfitrion_id', 'anfitrion_nombre', 'estado', 'solicitada_en', 'motivo_devolucion', 'motivo_bloqueo',
      'politica_cancelacion', 'servicios_adicionales', 'creado_en', 'extra',
    ],
    jsonbColumns: ['descuento_estancia', 'servicios_adicionales', 'extra'],
    arrayColumns: ['servicios', 'reglas', 'imagenes', 'campos_faltantes'],
  },
  notificaciones_anfitrion: {
    tableName: 'notificaciones_anfitrion',
    primaryKey: ['id'],
    columns: ['id', 'orden', 'publicacion_id', 'anfitrion_id', 'tipo', 'mensaje', 'motivo', 'creado_en', 'extra'],
    jsonbColumns: ['extra'],
  },
  periodos_disponibles: {
    tableName: 'periodos_disponibles',
    primaryKey: ['id'],
    columns: ['id', 'orden', 'publicacion_id', 'fecha_inicio', 'fecha_fin', 'disponible', 'creado_en', 'extra'],
    jsonbColumns: ['extra'],
  },
  periodos_reservados: {
    tableName: 'periodos_reservados',
    primaryKey: ['id'],
    columns: ['id', 'orden', 'publicacion_id', 'reserva_id', 'tipo', 'fecha_llegada', 'fecha_salida', 'noches', 'creado_en', 'extra'],
    jsonbColumns: ['extra'],
    arrayColumns: ['noches'],
  },
  huespedes_con_reserva: {
    tableName: 'huespedes_con_reserva',
    primaryKey: ['publicacion_id', 'usuario_id'],
    columns: ['publicacion_id', 'usuario_id', 'extra'],
    jsonbColumns: ['extra'],
  },
  reservas: {
    tableName: 'reservas',
    primaryKey: ['id'],
    columns: [
      'id', 'orden', 'publicacion_id', 'huesped_id', 'fecha_llegada', 'fecha_salida',
      'huespedes', 'tarifa_servicio', 'total', 'moneda', 'estado', 'clave_idempotencia',
      'peticiones_especiales', 'creado_en', 'extra',
    ],
    jsonbColumns: ['extra'],
  },
  configuracion_plataforma: {
    tableName: 'configuracion_plataforma',
    primaryKey: ['clave'],
    columns: ['clave', 'valor', 'actualizado_en', 'actualizado_por', 'extra'],
    jsonbColumns: ['valor', 'extra'],
  },
};

export const REGISTERED_SOURCE_TABLES: Record<string, string[]> = {
  auth: ['usuarios', 'sesiones'],
  audit: ['eventos_auditoria'],
  passwordRecovery: ['tokens_recuperacion', 'correos_simulados', 'solicitudes_recuperacion'],
  bookings: ['reservas'],
  listings: ['publicaciones', 'notificaciones_anfitrion', 'periodos_disponibles', 'periodos_reservados', 'huespedes_con_reserva'],
  'platform-config': ['configuracion_plataforma'],
};

export function toIso(date: unknown): string | null {
  if (!date) return null;
  if (date instanceof Date) return date.toISOString();
  if (typeof date === 'string') {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? date : parsed.toISOString();
  }
  return null;
}

export function toDateOnly(date: unknown): string | null {
  if (!date) return null;
  if (typeof date === 'string') return date.slice(0, 10);
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  return null;
}

export function stableJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(stableJson).join(',')}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableJson((obj as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function serializePkValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  return JSON.stringify(val);
}

export function rowKey(table: TableDefinition, row: Record<string, unknown>): string {
  return table.primaryKey.map((pk) => serializePkValue(row[pk])).join('::');
}

/**
 * Normaliza una fila leída de Postgres para convertirla en representación canónica:
 * Date a ISO string, null en vez de undefined, números preservados.
 */
export function normalizeDbRow(tableName: string, raw: Record<string, unknown>): Record<string, unknown> {
  const def = TABLE_DEFINITIONS[tableName];
  if (!def) return raw;

  const result: Record<string, unknown> = {};
  for (const col of def.columns) {
    let val = raw[col];
    if (val === undefined) {
      val = null;
    } else if (val instanceof Date) {
      val = val.toISOString();
    } else if (def.jsonbColumns?.includes(col) && typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch {
        // mantener string si no es parseable
      }
    }
    result[col] = val ?? null;
  }
  return result;
}

/**
 * Convierte el volcado en memoria de una fuente a filas por tabla.
 */
export function sourceToRows(sourceKey: string, dump: unknown): Record<string, Record<string, unknown>[]> {
  const result: Record<string, Record<string, unknown>[]> = {};

  switch (sourceKey) {
    case 'auth': {
      const { users, sessions } = (dump as {
        users: Array<[string, Record<string, unknown>]>;
        sessions: Array<[string, Record<string, unknown>]>;
      }) ?? { users: [], sessions: [] };

      result.usuarios = (users ?? []).map(([_email, u]) => {
        const { id, name, email, phone, passwordHash, role, status, restrictionReason, createdAt, ...rest } = u as any;
        return {
          id: String(id),
          nombre: name ?? '',
          correo: email ?? '',
          telefono: phone ?? null,
          contrasena_hash: passwordHash ?? '',
          rol: role ?? '',
          estado: status ?? '',
          motivo_restriccion: restrictionReason ?? null,
          creado_en: toIso(createdAt) ?? new Date().toISOString(),
          extra: rest ?? {},
        };
      });

      result.sesiones = (sessions ?? []).map(([token, s]) => {
        const { userId, email, role, expiresAt, ...rest } = s as any;
        return {
          token: String(token),
          usuario_id: String(userId),
          correo: email ?? '',
          rol: role ?? '',
          expira_en: Number(expiresAt),
          extra: rest ?? {},
        };
      });
      break;
    }

    case 'audit': {
      const events = (dump as Record<string, unknown>[]) ?? [];
      result.eventos_auditoria = events.map((ev: any, index) => {
        const { id, actor, action, entity, entityId, occurredAt, result: r, detail, ...rest } = ev;
        return {
          id: String(id),
          orden: index,
          actor: actor ?? '',
          accion: action ?? '',
          entidad: entity ?? '',
          entidad_id: entityId ?? null,
          ocurrido_en: toIso(occurredAt) ?? new Date().toISOString(),
          resultado: r ?? '',
          detalle: detail ?? null,
          extra: rest ?? {},
        };
      });
      break;
    }

    case 'passwordRecovery': {
      const { tokens, mailbox, requestLog } = (dump as {
        tokens: Array<[string, Record<string, unknown>]>;
        mailbox: Record<string, unknown>[];
        requestLog: Array<[string, number[]]>;
      }) ?? { tokens: [], mailbox: [], requestLog: [] };

      result.tokens_recuperacion = (tokens ?? []).map(([hash, t]: any) => ({
        hash: String(hash),
        correo: t?.email ?? '',
        expira_en: Number(t?.expiresAt ?? 0),
        usado: Boolean(t?.used),
        extra: {},
      }));

      result.correos_simulados = (mailbox ?? []).map((m: any, index) => ({
        id: String(m?.id ?? `mail-${index}`),
        orden: index,
        para: m?.to ?? '',
        asunto: m?.subject ?? '',
        cuerpo: m?.body ?? '',
        token: m?.token ?? null,
        expira_en: m?.expiresAt ? Number(m.expiresAt) : null,
        enviado_en: toIso(m?.sentAt) ?? new Date().toISOString(),
        extra: {},
      }));

      result.solicitudes_recuperacion = (requestLog ?? []).map(([email, times]) => ({
        correo: String(email),
        intentos: (times ?? []).map(Number),
        extra: {},
      }));
      break;
    }

    case 'bookings': {
      const bookings = (dump as Record<string, unknown>[]) ?? [];
      result.reservas = bookings.map((b: any, index) => {
        const {
          id, listingId, guestId, checkIn, checkOut, guests,
          serviceFee, totalAmount, currency, status, idempotencyKey, specialRequests, createdAt,
          ...rest
        } = b;
        return {
          id: String(id),
          orden: index,
          publicacion_id: String(listingId),
          huesped_id: String(guestId),
          fecha_llegada: String(checkIn),
          fecha_salida: String(checkOut),
          huespedes: Number(guests ?? 1),
          tarifa_servicio: serviceFee != null ? Number(serviceFee) : null,
          total: Number(totalAmount ?? 0),
          moneda: currency ?? 'COP',
          estado: status ?? '',
          clave_idempotencia: idempotencyKey ?? null,
          peticiones_especiales: specialRequests ?? null,
          creado_en: toIso(createdAt) ?? new Date().toISOString(),
          extra: rest ?? {},
        };
      });
      break;
    }

    case 'listings': {
      const { listings, hostNotifications, availabilityPeriods, reservedPeriods, guestsWithReservations } =
        (dump as {
          listings: Record<string, unknown>[];
          hostNotifications: Record<string, unknown>[];
          availabilityPeriods: Record<string, unknown>[];
          reservedPeriods: Record<string, unknown>[];
          guestsWithReservations: string[];
        }) ?? {
          listings: [],
          hostNotifications: [],
          availabilityPeriods: [],
          reservedPeriods: [],
          guestsWithReservations: [],
        };

      result.publicaciones = (listings ?? []).map((l: any, index) => {
        const {
          id, title, description, city, department, address, country, propertyType,
          pricePerNight, cleaningFee, longStayDiscount, maxGuests, bedrooms, bathrooms,
          amenities, rules, images, isComplete, missingFields, rating, reviewCount,
          hostId, hostName, status, requestedAt, returnReason, blockReason, cancellationPolicy,
          additionalServices, createdAt, ...rest
        } = l;

        return {
          id: String(id),
          orden: index,
          titulo: title ?? '',
          descripcion: description ?? null,
          ciudad: city ?? null,
          departamento: department ?? null,
          direccion: address ?? null,
          pais: country ?? null,
          tipo: propertyType ?? null,
          precio_noche: pricePerNight != null ? Number(pricePerNight) : null,
          tarifa_limpieza: cleaningFee != null ? Number(cleaningFee) : null,
          descuento_estancia: longStayDiscount ?? null,
          capacidad: maxGuests != null ? Number(maxGuests) : null,
          habitaciones: bedrooms != null ? Number(bedrooms) : null,
          banos: bathrooms != null ? Number(bathrooms) : null,
          servicios: amenities ?? null,
          reglas: rules ?? null,
          imagenes: images ?? null,
          completa: isComplete != null ? Boolean(isComplete) : null,
          campos_faltantes: missingFields ?? null,
          calificacion: rating != null ? Number(rating) : null,
          total_resenas: reviewCount != null ? Number(reviewCount) : null,
          anfitrion_id: hostId ?? null,
          anfitrion_nombre: hostName ?? null,
          estado: status ?? null,
          solicitada_en: toIso(requestedAt),
          motivo_devolucion: returnReason ?? null,
          motivo_bloqueo: blockReason ?? null,
          politica_cancelacion: cancellationPolicy ?? null,
          servicios_adicionales: additionalServices ?? null,
          creado_en: toIso(createdAt),
          extra: rest ?? {},
        };
      });

      result.notificaciones_anfitrion = (hostNotifications ?? []).map((n: any, index) => {
        const { id, listingId, hostId, type, message, reason, createdAt, ...rest } = n;
        return {
          id: String(id),
          orden: index,
          publicacion_id: listingId ?? null,
          anfitrion_id: hostId ?? '',
          tipo: type ?? '',
          mensaje: message ?? '',
          motivo: reason ?? null,
          creado_en: toIso(createdAt) ?? new Date().toISOString(),
          extra: rest ?? {},
        };
      });

      result.periodos_disponibles = (availabilityPeriods ?? []).map((p: any, index) => {
        const { id, listingId, startDate, endDate, availableForBooking, createdAt, ...rest } = p;
        return {
          id: String(id),
          orden: index,
          publicacion_id: String(listingId),
          fecha_inicio: toDateOnly(startDate)!,
          fecha_fin: toDateOnly(endDate)!,
          disponible: availableForBooking != null ? Boolean(availableForBooking) : true,
          creado_en: toIso(createdAt),
          extra: rest ?? {},
        };
      });

      result.periodos_reservados = (reservedPeriods ?? []).map((r: any, index) => {
        const { id, listingId, bookingId, type, checkIn, checkOut, blockedNights, createdAt, ...rest } = r;
        return {
          id: String(id),
          orden: index,
          publicacion_id: String(listingId),
          reserva_id: bookingId ?? null,
          tipo: type ?? 'RESERVA',
          fecha_llegada: toDateOnly(checkIn)!,
          fecha_salida: toDateOnly(checkOut)!,
          noches: blockedNights ?? [],
          creado_en: toIso(createdAt),
          extra: rest ?? {},
        };
      });

      // ListingsService guarda cada clave como `publicaciónId|usuarioId` (HU-026); se separa en el primer "|".
      result.huespedes_con_reserva = (guestsWithReservations ?? []).map((key: string) => {
        const separator = key.indexOf('|');
        return {
          publicacion_id: key.slice(0, separator),
          usuario_id: key.slice(separator + 1),
          extra: {},
        };
      });
      break;
    }

    case 'platform-config': {
      const config = (dump as Record<string, unknown>) ?? {};
      const { serviceFeePercent, updatedAt, updatedBy, ...rest } = config as any;
      result.configuracion_plataforma = [
        {
          clave: 'service_fee',
          valor: { serviceFeePercent: Number(serviceFeePercent ?? 12), ...rest },
          actualizado_en: toIso(updatedAt) ?? new Date().toISOString(),
          actualizado_por: updatedBy ?? 'sistema',
          extra: {},
        },
      ];
      break;
    }

    default:
      break;
  }

  return result;
}

/**
 * Convierte las filas de PostgreSQL leídas por tabla al formato esperado por el método restore().
 */
export function rowsToSource(sourceKey: string, tablesData: Record<string, Record<string, unknown>[]>): unknown {
  switch (sourceKey) {
    case 'auth': {
      const usuarios = tablesData.usuarios ?? [];
      const sesiones = tablesData.sesiones ?? [];

      const users: Array<[string, Record<string, unknown>]> = usuarios.map((row: any) => {
        const extra = row.extra ?? {};
        return [
          row.correo,
          {
            id: row.id,
            name: row.nombre,
            email: row.correo,
            phone: row.telefono ?? undefined,
            passwordHash: row.contrasena_hash,
            role: row.rol,
            status: row.estado,
            restrictionReason: row.motivo_restriccion ?? undefined,
            createdAt: row.creado_en ? new Date(row.creado_en) : new Date(),
            ...extra,
          },
        ];
      });

      const sessions: Array<[string, Record<string, unknown>]> = sesiones.map((row: any) => {
        const extra = row.extra ?? {};
        return [
          row.token,
          {
            token: row.token,
            userId: row.usuario_id,
            email: row.correo,
            role: row.rol,
            expiresAt: Number(row.expira_en),
            ...extra,
          },
        ];
      });

      return { users, sessions };
    }

    case 'audit': {
      const eventos = [...(tablesData.eventos_auditoria ?? [])].sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
      return eventos.map((row: any) => {
        const extra = row.extra ?? {};
        return {
          id: row.id,
          actor: row.actor,
          action: row.accion,
          entity: row.entidad,
          entityId: row.entidad_id ?? undefined,
          occurredAt: row.ocurrido_en,
          result: row.resultado,
          detail: row.detalle ?? undefined,
          ...extra,
        };
      });
    }

    case 'passwordRecovery': {
      const tokensRec = tablesData.tokens_recuperacion ?? [];
      const correos = [...(tablesData.correos_simulados ?? [])].sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
      const solicitudes = tablesData.solicitudes_recuperacion ?? [];

      const tokens: Array<[string, Record<string, unknown>]> = tokensRec.map((row: any) => [
        row.hash,
        {
          email: row.correo,
          expiresAt: Number(row.expira_en),
          used: Boolean(row.usado),
        },
      ]);

      const mailbox = correos.map((row: any) => ({
        id: row.id,
        to: row.para,
        subject: row.asunto,
        body: row.cuerpo,
        token: row.token ?? undefined,
        expiresAt: row.expira_en != null ? Number(row.expira_en) : undefined,
        sentAt: row.enviado_en ? new Date(row.enviado_en) : new Date(),
      }));

      const requestLog: Array<[string, number[]]> = solicitudes.map((row: any) => [
        row.correo,
        Array.isArray(row.intentos) ? row.intentos.map(Number) : [],
      ]);

      return { tokens, mailbox, requestLog };
    }

    case 'bookings': {
      const reservas = [...(tablesData.reservas ?? [])].sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
      return reservas.map((row: any) => {
        const extra = row.extra ?? {};
        return {
          id: row.id,
          listingId: row.publicacion_id,
          guestId: row.huesped_id,
          checkIn: row.fecha_llegada,
          checkOut: row.fecha_salida,
          guests: Number(row.huespedes),
          serviceFee: row.tarifa_servicio != null ? Number(row.tarifa_servicio) : undefined,
          totalAmount: Number(row.total),
          currency: row.moneda,
          status: row.estado,
          idempotencyKey: row.clave_idempotencia ?? undefined,
          specialRequests: row.peticiones_especiales ?? undefined,
          createdAt: row.creado_en ? new Date(row.creado_en) : new Date(),
          ...extra,
        };
      });
    }

    case 'listings': {
      const pubs = [...(tablesData.publicaciones ?? [])].sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
      const notifs = [...(tablesData.notificaciones_anfitrion ?? [])].sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
      const perDisp = [...(tablesData.periodos_disponibles ?? [])].sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
      const perRes = [...(tablesData.periodos_reservados ?? [])].sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0));
      const huespedes = tablesData.huespedes_con_reserva ?? [];

      const listings = pubs.map((row: any) => {
        const extra = row.extra ?? {};
        return {
          id: row.id,
          title: row.titulo,
          description: row.descripcion ?? undefined,
          city: row.ciudad ?? undefined,
          department: row.departamento ?? undefined,
          address: row.direccion ?? undefined,
          country: row.pais ?? undefined,
          propertyType: row.tipo ?? undefined,
          pricePerNight: row.precio_noche != null ? Number(row.precio_noche) : undefined,
          cleaningFee: row.tarifa_limpieza != null ? Number(row.tarifa_limpieza) : undefined,
          longStayDiscount: row.descuento_estancia ?? undefined,
          maxGuests: row.capacidad != null ? Number(row.capacidad) : undefined,
          bedrooms: row.habitaciones != null ? Number(row.habitaciones) : undefined,
          bathrooms: row.banos != null ? Number(row.banos) : undefined,
          amenities: row.servicios ?? [],
          rules: row.reglas ?? [],
          images: row.imagenes ?? [],
          isComplete: row.completa != null ? Boolean(row.completa) : false,
          missingFields: row.campos_faltantes ?? [],
          rating: row.calificacion != null ? Number(row.calificacion) : 0,
          reviewCount: row.total_resenas != null ? Number(row.total_resenas) : 0,
          hostId: row.anfitrion_id ?? undefined,
          hostName: row.anfitrion_nombre ?? undefined,
          status: row.estado ?? undefined,
          requestedAt: row.solicitada_en ? new Date(row.solicitada_en) : undefined,
          returnReason: row.motivo_devolucion ?? undefined,
          blockReason: row.motivo_bloqueo ?? undefined,
          politica_cancelacion: row.politica_cancelacion ?? undefined,
          servicios_adicionales: row.servicios_adicionales ?? undefined,
          createdAt: row.creado_en ? new Date(row.creado_en) : new Date(),
          ...extra,
        };
      });

      const hostNotifications = notifs.map((row: any) => {
        const extra = row.extra ?? {};
        return {
          id: row.id,
          listingId: row.publicacion_id ?? undefined,
          hostId: row.anfitrion_id,
          type: row.tipo,
          message: row.mensaje,
          reason: row.motivo ?? undefined,
          createdAt: row.creado_en ? new Date(row.creado_en) : new Date(),
          ...extra,
        };
      });

      const availabilityPeriods = perDisp.map((row: any) => {
        const extra = row.extra ?? {};
        return {
          id: row.id,
          listingId: row.publicacion_id,
          startDate: toDateOnly(row.fecha_inicio)!,
          endDate: toDateOnly(row.fecha_fin)!,
          availableForBooking: Boolean(row.disponible),
          createdAt: row.creado_en ? new Date(row.creado_en) : undefined,
          ...extra,
        };
      });

      const reservedPeriods = perRes.map((row: any) => {
        const extra = row.extra ?? {};
        return {
          id: row.id,
          listingId: row.publicacion_id,
          bookingId: row.reserva_id ?? undefined,
          type: row.tipo ?? 'RESERVA',
          checkIn: toDateOnly(row.fecha_llegada)!,
          checkOut: toDateOnly(row.fecha_salida)!,
          blockedNights: row.noches ?? [],
          createdAt: row.creado_en ? new Date(row.creado_en) : undefined,
          ...extra,
        };
      });

      const guestsWithReservations = huespedes.map((row: any) => `${row.publicacion_id}|${row.usuario_id}`);

      return {
        listings,
        hostNotifications,
        availabilityPeriods,
        reservedPeriods,
        guestsWithReservations,
      };
    }

    case 'platform-config': {
      const rows = tablesData.configuracion_plataforma ?? [];
      const serviceFeeRow = rows.find((r: any) => r.clave === 'service_fee') ?? rows[0];
      if (!serviceFeeRow) {
        return { serviceFeePercent: 12, updatedAt: new Date(), updatedBy: 'sistema' };
      }
      const val = (serviceFeeRow.valor && typeof serviceFeeRow.valor === 'object') ? (serviceFeeRow.valor as Record<string, unknown>) : {};
      return {
        serviceFeePercent: Number(val?.serviceFeePercent ?? 12),
        updatedAt: serviceFeeRow.actualizado_en ? new Date(serviceFeeRow.actualizado_en as string) : new Date(),
        updatedBy: serviceFeeRow.actualizado_por ?? 'sistema',
      };
    }

    default:
      return null;
  }
}

export interface TableChanges {
  upserts: Record<string, unknown>[];
  deletes: Array<Record<string, unknown>>;
  newSaved: Map<string, Record<string, unknown>>;
}

/**
 * Calcula diferencias entre lo guardado en memoria y las filas actuales de una tabla.
 */
export function computeChanges(
  tableName: string,
  savedMap: Map<string, Record<string, unknown>>,
  currentRows: Record<string, unknown>[],
): TableChanges {
  const def = TABLE_DEFINITIONS[tableName];
  if (!def) {
    throw new Error(`Definición de tabla no encontrada para "${tableName}"`);
  }

  const currentMap = new Map<string, Record<string, unknown>>();
  const upserts: Record<string, unknown>[] = [];
  const deletes: Array<Record<string, unknown>> = [];

  for (const row of currentRows) {
    const key = rowKey(def, row);
    currentMap.set(key, row);

    const prev = savedMap.get(key);
    if (!prev || stableJson(prev) !== stableJson(row)) {
      upserts.push(row);
    }
  }

  for (const [key, prevRow] of savedMap.entries()) {
    if (!currentMap.has(key)) {
      const pkObj: Record<string, unknown> = {};
      for (const pk of def.primaryKey) {
        pkObj[pk] = prevRow[pk];
      }
      deletes.push(pkObj);
    }
  }

  return { upserts, deletes, newSaved: currentMap };
}
