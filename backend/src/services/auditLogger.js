import db from '../config/db.js';

const SAFE_METADATA_KEYS = new Set([
  'reason',
  'method',
  'path',
  'role',
  'requiredRoles',
  'status',
  'endpoint',
  'count',
  'isSuspended',
  'targetRole',
]);

const sanitizeMetadata = (metadata = {}) => {
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      safe[key] = value;
    }
  }
  return safe;
};

export const logAuditEvent = async ({
  actorId = null,
  action,
  targetType = null,
  targetId = null,
  req,
  metadata = {},
}) => {
  if (!action) throw new Error('Audit event action is required');

  try {
    await db.query(
      `INSERT INTO audit_logs
         (actor_id, action, target_type, target_id, ip_address, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        actorId,
        action,
        targetType,
        targetId === null ? null : String(targetId),
        req?.ip || null,
        JSON.stringify(sanitizeMetadata(metadata)),
      ]
    );
  } catch (error) {
    console.error('Audit event could not be persisted:', {
      action,
      message: error.message,
    });
    throw error;
  }
};

export default logAuditEvent;
