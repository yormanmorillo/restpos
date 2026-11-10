export function audit(db, staffId, action, entityType, entityId = null, details = '') {
  const record = typeof details === 'string' ? details : JSON.stringify(details);
  try {
    db.prepare(`
      INSERT INTO audit_logs (staff_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(staffId ?? null, action, entityType, entityId ?? null, record, new Date().toISOString());
  } catch (error) {
    console.error('[audit] No se pudo registrar la auditoría:', error.message);
  }
}
