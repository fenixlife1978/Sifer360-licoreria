'use strict';

/**
 * Autoriza operaciones contables a partir de la sesión emitida por Electron.
 * Nunca recibe actorId/actorRole del renderer: la identidad y el rol se
 * vuelven a consultar en SQLite para detectar cambios o desactivaciones.
 */
function createAccountingSessionGuard({ sessions, findActiveUser, now = Date.now }) {
  if (!sessions || typeof sessions.get !== 'function' || typeof sessions.delete !== 'function') {
    throw new TypeError('Se requiere el almacén de sesiones de autenticación.');
  }
  if (typeof findActiveUser !== 'function') {
    throw new TypeError('Se requiere un lector de usuarios activos desde SQLite.');
  }

  return function requireAccountingSession(token, options = {}) {
    const key = typeof token === 'string' ? token : '';
    if (!key || key.length > 256) {
      throw new Error('Se requiere una sesión autenticada para acceder a Contabilidad.');
    }

    const session = sessions.get(key);
    if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= now()) {
      if (session) sessions.delete(key);
      throw new Error('La sesión expiró. Inicie sesión nuevamente.');
    }

    const username = String(session.user && session.user.username || '').trim();
    if (!username) {
      sessions.delete(key);
      throw new Error('La sesión no tiene una identidad válida. Inicie sesión nuevamente.');
    }

    const currentUser = findActiveUser(username);
    if (!currentUser || currentUser.active === 0 || currentUser.active === false) {
      for (const [sessionToken, candidate] of sessions) {
        if (String(candidate.user && candidate.user.username || '').toLowerCase() === username.toLowerCase()) {
          sessions.delete(sessionToken);
        }
      }
      throw new Error('El usuario ya no está activo. Inicie sesión nuevamente.');
    }

    const role = String(currentUser.role || '').trim().toLowerCase();
    const allowedRoles = Array.isArray(options.allowedRoles)
      ? options.allowedRoles.map(value => String(value).toLowerCase())
      : ['admin', 'contador'];

    // Refresca la sesión con datos vigentes; nunca conserva un rol antiguo.
    session.user = {
      username: String(currentUser.username || username),
      name: String(currentUser.name || ''),
      role,
      cashbox: String(currentUser.cashbox || '—')
    };
    sessions.set(key, session);

    if (!allowedRoles.includes(role)) {
      throw new Error('El rol de usuario no está autorizado para esta operación contable.');
    }

    return {
      actorId: session.user.username,
      actorRole: role,
      username: session.user.username,
      name: session.user.name,
      cashbox: session.user.cashbox
    };
  };
}

module.exports = { createAccountingSessionGuard };
