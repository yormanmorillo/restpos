import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { AppError, validationError } from './errors.js';
import { loginSchema, setupSchema, parseOrThrow } from './validation.js';

export const SESSION_COOKIE = 'restpos_session';
const SESSION_TTL_MS_DEFAULT = 12 * 60 * 60 * 1000;
const PIN_PATTERN = /^\d{4,8}$/;

const loginAttempts = new Map();
const MAX_ATTEMPTS = 8;
const MAX_IP_ATTEMPTS = 40;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export function hashPin(pin) {
  if (!PIN_PATTERN.test(String(pin))) {
    throw new Error('El PIN debe tener entre 4 y 8 dígitos.');
  }
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(String(pin), salt, 32).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

export function verifyPin(pin, stored) {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin) || typeof stored !== 'string') return false;
  const [scheme, salt, digestHex] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !digestHex) return false;
  const expected = Buffer.from(digestHex, 'hex');
  const actual = scryptSync(pin, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(header = '') {
  return Object.fromEntries(
    String(header)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

export function serializeStaff(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    role: row.role,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare(`
      SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
             st.id, st.name, st.role, st.active, st.created_at, st.updated_at
      FROM sessions s
      JOIN staff st ON st.id = s.staff_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND st.active = 1
    `)
    .get(hashToken(token), new Date().toISOString());
  if (!row) return null;
  return {
    sessionId: Number(row.session_id),
    staff: serializeStaff(row),
    lastSeenAt: row.last_seen_at,
  };
}

export function authenticate(db) {
  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const session = loadSession(db, cookies[SESSION_COOKIE]);
    if (!session) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Inicia sesión para continuar.'));
    }
    req.staff = session.staff;
    req.sessionId = session.sessionId;
    const lastSeen = new Date(session.lastSeenAt).getTime();
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 60_000) {
      db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        session.sessionId,
      );
    }
    return next();
  };
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.staff) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Inicia sesión para continuar.'));
    }
    if (roles.length > 0 && !roles.includes(req.staff.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'Tu rol no tiene permiso para esta acción.'));
    }
    return next();
  };
}

function createSession(db, staffId, config, res) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const ttlMs = (config.sessionTtlHours ?? 12) * 60 * 60 * 1000 || SESSION_TTL_MS_DEFAULT;
  const expires = new Date(now.getTime() + ttlMs);
  db.prepare(`
    INSERT INTO sessions (token_hash, staff_id, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(hashToken(token), staffId, now.toISOString(), expires.toISOString(), now.toISOString());
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(config.cookieSecure),
    path: '/',
    maxAge: ttlMs,
  });
  return token;
}

function clearSessionCookie(res, config) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(config.cookieSecure),
    path: '/',
  });
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.first > ATTEMPT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, first: now });
    return;
  }
  entry.count += 1;
}

function tooManyAttempts(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  const limit = key.startsWith('ip:') ? MAX_IP_ATTEMPTS : MAX_ATTEMPTS;
  return entry.count >= limit;
}

export function registerAuthRoutes(router, db, config) {
  router.get('/auth/status', (req, res, next) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const session = loadSession(db, cookies[SESSION_COOKIE]);
      const staffCount = Number(
        db.prepare('SELECT COUNT(*) AS count FROM staff').get().count,
      );
      res.json({
        setupRequired: staffCount === 0,
        authenticated: Boolean(session),
        staff: session?.staff ?? null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/auth/options', (req, res) => {
    const staff = db
      .prepare('SELECT id, name, role FROM staff WHERE active = 1 ORDER BY name')
      .all()
      .map((row) => ({ id: Number(row.id), name: row.name, role: row.role }));
    res.json({ staff });
  });

  router.post('/auth/setup', (req, res, next) => {
    try {
      const staffCount = Number(db.prepare('SELECT COUNT(*) AS count FROM staff').get().count);
      if (staffCount > 0) {
        throw new AppError(409, 'SETUP_COMPLETE', 'La configuración inicial ya fue completada.');
      }
      const input = parseOrThrow(setupSchema, req.body);
      const now = new Date().toISOString();
      const result = db
        .prepare(`
          INSERT INTO staff (name, role, pin_hash, active, created_at, updated_at)
          VALUES (?, 'admin', ?, 1, ?, ?)
        `)
        .run(input.name, hashPin(input.pin), now, now);
      const staffId = Number(result.lastInsertRowid);
      createSession(db, staffId, config, res);
      db.prepare(`
        INSERT INTO audit_logs (staff_id, action, entity_type, entity_id, details, created_at)
        VALUES (?, 'setup', 'staff', ?, 'Administrador inicial creado', ?)
      `).run(staffId, staffId, now);
      const staff = serializeStaff(db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId));
      res.status(201).json({ staff });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/login', (req, res, next) => {
    try {
      const input = parseOrThrow(loginSchema, req.body);
      const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(input.staffId);
      if (!staff || !staff.active) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'PIN incorrecto o empleado inactivo.');
      }
      const key = `staff:${input.staffId}`;
      const ipKey = `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
      if (tooManyAttempts(key) || tooManyAttempts(ipKey)) {
        throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos. Espera unos minutos.');
      }
      if (!verifyPin(input.pin, staff.pin_hash)) {
        recordLoginFailure(key);
        recordLoginFailure(ipKey);
        throw new AppError(401, 'INVALID_CREDENTIALS', 'PIN incorrecto.');
      }
      loginAttempts.delete(key);
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
      createSession(db, Number(staff.id), config, res);
      db.prepare(`
        INSERT INTO audit_logs (staff_id, action, entity_type, entity_id, details, created_at)
        VALUES (?, 'login', 'staff', ?, 'Inicio de sesión', ?)
      `).run(Number(staff.id), Number(staff.id), new Date().toISOString());
      res.json({ staff: serializeStaff(staff) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/logout', (req, res, next) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[SESSION_COOKIE];
      if (token) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      }
      clearSessionCookie(res, config);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });
}

function validationPin(value) {
  if (!PIN_PATTERN.test(String(value))) {
    throw validationError('El PIN debe tener entre 4 y 8 dígitos.');
  }
  return value;
}

export function createStaff(db, input, staffId, actorRole = null, now = new Date().toISOString()) {
  if (input.role === 'owner' && actorRole !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Solo el propietario puede crear otro propietario.');
  }
  const pin = validationPin(input.pin);
  const role = input.role;
  const result = db
    .prepare(`
      INSERT INTO staff (name, role, pin_hash, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(input.name, role, hashPin(pin), input.active === false ? 0 : 1, now, now);
  const id = Number(result.lastInsertRowid);
  db.prepare(`
    INSERT INTO audit_logs (staff_id, action, entity_type, entity_id, details, created_at)
    VALUES (?, 'staff.create', 'staff', ?, ?, ?)
  `).run(staffId, id, JSON.stringify({ name: input.name, role }), now);
  return serializeStaff(db.prepare('SELECT * FROM staff WHERE id = ?').get(id));
}

export function updateStaff(db, id, input, actorId, actorRole = null, now = new Date().toISOString()) {
  const existing = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'No se encontró el empleado.');
  if (existing.role === 'owner' && actorRole !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Solo el propietario puede modificar al propietario.');
  }
  if (input.role === 'owner' && actorRole !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Solo el propietario puede asignar el rol de propietario.');
  }
  if (existing.role === 'owner' && existing.active) {
    const activeOwners = Number(
      db.prepare("SELECT COUNT(*) AS count FROM staff WHERE role = 'owner' AND active = 1").get().count,
    );
    const staysOwner = (input.role ?? existing.role) === 'owner' && (input.active ?? true);
    if (!staysOwner && activeOwners <= 1) {
      throw new AppError(403, 'FORBIDDEN', 'Debe existir al menos un propietario activo.');
    }
  }
  const activeAdmins = Number(
    db.prepare("SELECT COUNT(*) AS count FROM staff WHERE role = 'admin' AND active = 1").get().count,
  );
  const willRemainAdmin =
    (input.role ?? existing.role) === 'admin' && (input.active ?? Boolean(existing.active));
  if (existing.role === 'admin' && existing.active && !willRemainAdmin && activeAdmins <= 1) {
    throw validationError('Debe existir al menos un administrador activo.');
  }
  if (Number(id) === Number(actorId) && input.active === false) {
    throw validationError('No puedes desactivar tu propio usuario.');
  }
  const fields = [];
  const params = [];
  if (input.name !== undefined) {
    fields.push('name = ?');
    params.push(input.name);
  }
  if (input.role !== undefined) {
    fields.push('role = ?');
    params.push(input.role);
  }
  if (input.active !== undefined) {
    fields.push('active = ?');
    params.push(input.active ? 1 : 0);
  }
  if (input.pin !== undefined) {
    fields.push('pin_hash = ?');
    params.push(hashPin(validationPin(input.pin)));
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE staff SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  db.prepare(`
    INSERT INTO audit_logs (staff_id, action, entity_type, entity_id, details, created_at)
    VALUES (?, 'staff.update', 'staff', ?, ?, ?)
  `).run(actorId, id, JSON.stringify({ name: input.name, role: input.role, active: input.active, pinChanged: input.pin !== undefined }), now);
  return serializeStaff(db.prepare('SELECT * FROM staff WHERE id = ?').get(id));
}

export function listStaff(db) {
  return db
    .prepare('SELECT * FROM staff ORDER BY active DESC, name')
    .all()
    .map(serializeStaff);
}
