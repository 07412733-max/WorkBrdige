import express from 'express';
import db from '../config/db.js';
import { verifyToken, authorizeRole } from '../middleware/auth.js';
import { validateRequest, suspendUserSchema, isValidUUID } from '../middleware/validate.js';
import { getDbEncryptionKey } from '../config/encryption.js';
import { logAuditEvent } from '../services/auditLogger.js';

const router = express.Router();

// All routes in this file require admin role
router.use(verifyToken);
router.use(authorizeRole('admin'));

router.get('/audit-logs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const result = await db.query(
      `SELECT id, actor_id, action, target_type, target_id, ip_address,
              metadata, previous_hash, entry_hash, created_at
       FROM audit_logs
       ORDER BY created_at DESC, id DESC
       LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit]
    );
    res.json({ auditLogs: result.rows, pagination: { page, limit } });
  } catch (error) {
    console.error('Admin get audit logs error:', error.message);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// ============================================================================
// USER MANAGEMENT
// ============================================================================

/**
 * GET /api/admin/users
 * Get all users with filtering and pagination
 * RBAC: admin only
 */
router.get('/users', async (req, res) => {
  try {
    const { role, is_suspended, search, page = 1, limit = 50 } = req.query;

    let query = `
      SELECT 
        id, email, role, pgp_sym_decrypt(full_name_enc, $1)::text AS full_name,
        consent_given, is_suspended, 
        created_at, updated_at
      FROM users
      WHERE 1=1
    `;

    const params = [getDbEncryptionKey()];
    let paramCount = 2;

    // Role filter
    if (role && ['job_seeker', 'employer', 'admin'].includes(role)) {
      query += ` AND role = $${paramCount}`;
      params.push(role);
      paramCount++;
    }

    // Suspension status filter
    if (is_suspended !== undefined) {
      query += ` AND is_suspended = $${paramCount}`;
      params.push(is_suspended === 'true');
      paramCount++;
    }

    // Search filter (email or full name)
    if (search) {
      query += ` AND (email ILIKE $${paramCount} OR
        pgp_sym_decrypt(full_name_enc, $1)::text ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Order by most recent
    query += ` ORDER BY created_at DESC`;

    // Pagination
    const offset = (page - 1) * limit;
    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), offset);

    const result = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM users WHERE $1::text IS NOT NULL';
    const countParams = [getDbEncryptionKey()];
    let countParamNum = 2;

    if (role && ['job_seeker', 'employer', 'admin'].includes(role)) {
      countQuery += ` AND role = $${countParamNum}`;
      countParams.push(role);
      countParamNum++;
    }

    if (is_suspended !== undefined) {
      countQuery += ` AND is_suspended = $${countParamNum}`;
      countParams.push(is_suspended === 'true');
      countParamNum++;
    }

    if (search) {
      countQuery += ` AND (email ILIKE $${countParamNum} OR
        pgp_sym_decrypt(full_name_enc, $1)::text ILIKE $${countParamNum})`;
      countParams.push(`%${search}%`);
    }

    const countResult = await db.query(countQuery, countParams);
    const totalUsers = parseInt(countResult.rows[0].count);

    res.json({
      users: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalUsers,
        totalPages: Math.ceil(totalUsers / limit),
      },
    });
  } catch (error) {
    console.error('Admin get users error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch users',
    });
  }
});

/**
 * GET /api/admin/users/:userId
 * Get detailed information about a specific user
 * RBAC: admin only
 */
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidUUID(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Get user details
    const userResult = await db.query(
      `SELECT 
        id, email, role, pgp_sym_decrypt(full_name_enc, $2)::text AS full_name,
        consent_given, is_suspended,
        created_at, updated_at
      FROM users
      WHERE id = $1`,
      [userId, getDbEncryptionKey()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Get additional stats based on role
    let stats = {};

    if (user.role === 'job_seeker') {
      const appResult = await db.query(
        `SELECT COUNT(*) as total_applications,
         COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
         COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
         COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
         FROM applications
         WHERE seeker_id = $1`,
        [userId]
      );
      stats.applications = appResult.rows[0];
    } else if (user.role === 'employer') {
      const jobResult = await db.query(
        `SELECT COUNT(*) as total_jobs,
         COUNT(CASE WHEN status = 'open' THEN 1 END) as open_jobs,
         COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_jobs
         FROM job_listings
         WHERE employer_id = $1`,
        [userId]
      );
      stats.jobs = jobResult.rows[0];

      const appResult = await db.query(
        `SELECT COUNT(*) as total_applications
         FROM applications a
         JOIN job_listings jl ON a.job_id = jl.id
         WHERE jl.employer_id = $1`,
        [userId]
      );
      stats.applications_received = parseInt(appResult.rows[0].total_applications);
    }

    res.json({
      user,
      stats,
    });
  } catch (error) {
    console.error('Admin get user details error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch user details',
    });
  }
});

/**
 * PATCH /api/admin/users/:userId/suspend
 * Suspend or unsuspend a user account
 * RBAC: admin only
 * 
 * Security: Logs suspension actions for audit trail
 */
router.patch(
  '/users/:userId/suspend',
  validateRequest(suspendUserSchema),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { is_suspended } = req.body;
      const adminId = req.user.userId;

      if (!isValidUUID(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }

      // Prevent self-suspension
      if (userId === adminId) {
        return res.status(400).json({
          error: 'You cannot suspend your own account',
        });
      }

      // Check if user exists
      const userCheck = await db.query(
        'SELECT id, role FROM users WHERE id = $1',
        [userId]
      );

      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const targetUser = userCheck.rows[0];

      // Update suspension status
      const result = await db.query(
        `UPDATE users 
         SET is_suspended = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, email, role,
           pgp_sym_decrypt(full_name_enc, $3)::text AS full_name,
           is_suspended, updated_at`,
        [is_suspended, userId, getDbEncryptionKey()]
      );

      await logAuditEvent({
        actorId: adminId,
        action: is_suspended ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED',
        targetType: 'user',
        targetId: userId,
        req,
        metadata: { targetRole: targetUser.role, isSuspended: is_suspended },
      });

      // If suspending, revoke all refresh tokens
      if (is_suspended) {
        await db.query(
          'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
          [userId]
        );
        console.log('✅ All refresh tokens revoked for suspended user', { userId });
      }

      res.json({
        message: is_suspended
          ? 'User account suspended successfully'
          : 'User account unsuspended successfully',
        user: result.rows[0],
      });
    } catch (error) {
      console.error('Admin suspend user error:', error.message);
      res.status(500).json({
        error: 'Failed to update user suspension status',
      });
    }
  }
);

/**
 * DELETE /api/admin/users/:userId
 * Delete a user account (use with caution)
 * RBAC: admin only
 * 
 * Note: Cascading deletes will remove all related data:
 * - Refresh tokens
 * - Job listings (for employers)
 * - Applications (for job seekers)
 */
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.userId;

    if (!isValidUUID(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Prevent self-deletion
    if (userId === adminId) {
      return res.status(400).json({
        error: 'You cannot delete your own account',
      });
    }

    // Get user info before deletion for logging
    const userCheck = await db.query(
      'SELECT id, role FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userCheck.rows[0];

    // Delete user (cascade will handle related records)
    await db.query('DELETE FROM users WHERE id = $1', [userId]);

    await logAuditEvent({
      actorId: adminId,
      action: 'USER_DELETED',
      targetType: 'user',
      targetId: userId,
      req,
      metadata: { targetRole: targetUser.role },
    });

    res.json({
      message: 'User account deleted successfully',
    });
  } catch (error) {
    console.error('Admin delete user error:', error.message);
    res.status(500).json({
      error: 'Failed to delete user account',
    });
  }
});

// ============================================================================
// JOB LISTINGS MANAGEMENT
// ============================================================================

/**
 * GET /api/admin/jobs
 * Get all job listings (including closed ones)
 * RBAC: admin only
 */
router.get('/jobs', async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;

    let query = `
      SELECT 
        jl.id, jl.title, jl.description, jl.location, jl.salary_range,
        jl.status, jl.created_at, jl.updated_at,
        u.id as employer_id,
        pgp_sym_decrypt(u.full_name_enc, $1)::text AS employer_name,
        u.email as employer_email,
        COUNT(a.id) as application_count
      FROM job_listings jl
      JOIN users u ON jl.employer_id = u.id
      LEFT JOIN applications a ON jl.id = a.job_id
    `;

    const params = [getDbEncryptionKey()];
    let paramCount = 2;

    // Status filter
    if (status && ['open', 'closed'].includes(status)) {
      query += ` WHERE jl.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    query += ` GROUP BY jl.id, u.id ORDER BY jl.created_at DESC`;

    // Pagination
    const offset = (page - 1) * limit;
    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), offset);

    const result = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM job_listings';
    const countParams = [];

    if (status && ['open', 'closed'].includes(status)) {
      countQuery += ' WHERE status = $1';
      countParams.push(status);
    }

    const countResult = await db.query(countQuery, countParams);
    const totalJobs = parseInt(countResult.rows[0].count);

    res.json({
      jobs: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalJobs,
        totalPages: Math.ceil(totalJobs / limit),
      },
    });
  } catch (error) {
    console.error('Admin get jobs error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch job listings',
    });
  }
});

/**
 * DELETE /api/admin/jobs/:jobId
 * Delete any job listing (moderation)
 * RBAC: admin only
 */
router.delete('/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!isValidUUID(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    // Get job info before deletion for audit attribution.
    const jobCheck = await db.query(
      `SELECT jl.id, jl.employer_id
       FROM job_listings jl
       JOIN users u ON jl.employer_id = u.id
       WHERE jl.id = $1`,
      [jobId]
    );

    if (jobCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Delete job
    await db.query('DELETE FROM job_listings WHERE id = $1', [jobId]);

    await logAuditEvent({
      actorId: req.user.userId,
      action: 'JOB_DELETED',
      targetType: 'job',
      targetId: jobId,
      req,
    });

    res.json({
      message: 'Job listing deleted successfully',
    });
  } catch (error) {
    console.error('Admin delete job error:', error.message);
    res.status(500).json({
      error: 'Failed to delete job listing',
    });
  }
});

// ============================================================================
// STATISTICS & DASHBOARD
// ============================================================================

/**
 * GET /api/admin/stats
 * Get platform statistics for admin dashboard
 * RBAC: admin only
 */
router.get('/stats', async (req, res) => {
  try {
    // User statistics
    const userStats = await db.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN role = 'job_seeker' THEN 1 END) as job_seekers,
        COUNT(CASE WHEN role = 'employer' THEN 1 END) as employers,
        COUNT(CASE WHEN role = 'admin' THEN 1 END) as admins,
        COUNT(CASE WHEN is_suspended = true THEN 1 END) as suspended_users
      FROM users
    `);

    // Job statistics
    const jobStats = await db.query(`
      SELECT 
        COUNT(*) as total_jobs,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_jobs,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_jobs
      FROM job_listings
    `);

    // Application statistics
    const appStats = await db.query(`
      SELECT 
        COUNT(*) as total_applications,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'reviewed' THEN 1 END) as reviewed,
        COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
      FROM applications
    `);

    // Recent activity (last 7 days)
    const recentActivity = await db.query(`
      SELECT 
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as new_users_7d,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_users_30d
      FROM users
    `);

    const recentJobs = await db.query(`
      SELECT 
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as new_jobs_7d,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_jobs_30d
      FROM job_listings
    `);

    const recentApps = await db.query(`
      SELECT 
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as new_apps_7d,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_apps_30d
      FROM applications
    `);

    res.json({
      users: userStats.rows[0],
      jobs: jobStats.rows[0],
      applications: appStats.rows[0],
      recent_activity: {
        users: recentActivity.rows[0],
        jobs: recentJobs.rows[0],
        applications: recentApps.rows[0],
      },
    });
  } catch (error) {
    console.error('Admin get stats error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch statistics',
    });
  }
});

/**
 * GET /api/admin/activity
 * Get recent platform activity (last 50 actions)
 * RBAC: admin only
 */
router.get('/activity', async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    // Get recent users
    const recentUsers = await db.query(
      `SELECT id, email, role,
              pgp_sym_decrypt(full_name_enc, $1)::text AS full_name,
              created_at, 'user_registered' as activity_type
       FROM users
       ORDER BY created_at DESC
       LIMIT $2`,
      [getDbEncryptionKey(), Math.ceil(parseInt(limit, 10) / 3)]
    );

    // Get recent jobs
    const recentJobs = await db.query(
      `SELECT jl.id, jl.title, jl.created_at, 'job_created' as activity_type,
              pgp_sym_decrypt(u.full_name_enc, $2)::text AS employer_name
       FROM job_listings jl
       JOIN users u ON jl.employer_id = u.id
       ORDER BY jl.created_at DESC
       LIMIT $1`,
      [Math.ceil(parseInt(limit, 10) / 3), getDbEncryptionKey()]
    );

    // Get recent applications
    const recentApps = await db.query(
      `SELECT a.id, a.created_at, 'application_submitted' as activity_type,
              pgp_sym_decrypt(u.full_name_enc, $2)::text AS applicant_name,
              jl.title as job_title
       FROM applications a
       JOIN users u ON a.seeker_id = u.id
       JOIN job_listings jl ON a.job_id = jl.id
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [Math.ceil(parseInt(limit, 10) / 3), getDbEncryptionKey()]
    );

    // Combine and sort by date
    const allActivity = [
      ...recentUsers.rows,
      ...recentJobs.rows,
      ...recentApps.rows,
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({
      activity: allActivity.slice(0, parseInt(limit)),
    });
  } catch (error) {
    console.error('Admin get activity error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch activity',
    });
  }
});

export default router;
