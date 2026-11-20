import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../config/db.js';
import { validateRequest, registerSchema, loginSchema } from '../middleware/validate.js';
import { verifyToken } from '../middleware/auth.js';
import { generateCsrfToken, setCsrfCookie } from '../middleware/csrf.js';
import { getDbEncryptionKey } from '../config/encryption.js';
import { logAuditEvent } from '../services/auditLogger.js';

const router = express.Router();

/**
 * Generate JWT access token (short-lived)
 */
const generateAccessToken = (userId, email, role) => {
  return jwt.sign(
    { userId, email, role },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m',
      issuer: 'workbridge-api',
      audience: 'workbridge-client',
      algorithm: 'HS256',
    }
  );
};

/**
 * Generate refresh token (long-lived)
 */
const generateRefreshToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Hash refresh token for storage (SHA-256)
 */
const hashRefreshToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Store refresh token in database
 */
const storeRefreshToken = async (userId, token) => {
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) 
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );
};

/**
 * Set refresh token cookie (httpOnly, Secure in production, SameSite=Strict)
 */
const setRefreshTokenCookie = (res, token) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/auth', // Scoped to auth routes only
  });
};

/**
 * Clear refresh token cookie
 */
const clearRefreshTokenCookie = (res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
  });
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/auth/csrf-token
 * Generate and return a CSRF token
 * 
 * Security:
 * - Generates cryptographically random token (32 bytes)
 * - Sets token in non-httpOnly cookie (readable by JavaScript)
 * - Returns token in response body for immediate use
 * - SameSite=Strict prevents CSRF attacks
 */
router.get('/csrf-token', (req, res) => {
  try {
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    res.json({
      csrfToken,
    });
  } catch (error) {
    console.error('CSRF token generation error:', error.message);
    res.status(500).json({
      error: 'Failed to generate CSRF token',
    });
  }
});

/**
 * POST /api/auth/register
 * Register a new user
 * 
 * Security:
 * - Validates input with Zod schema (strict mode)
 * - Prevents 'admin' role registration (must be manually assigned in DB)
 * - Hashes password with bcrypt (cost factor 12)
 * - Enforces RA 10173 consent requirement
 */
router.post('/register', validateRequest(registerSchema), async (req, res) => {
  try {
    const { email, password, role, full_name, consent_given } = req.body;

    // Security: Prevent admin role registration via API
    if (role === 'admin') {
      return res.status(400).json({
        error: 'Cannot register as admin. Contact system administrator.',
      });
    }

    // Check if email already exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Email already registered',
      });
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(
      password,
      parseInt(process.env.BCRYPT_ROUNDS) || 12
    );

    // Insert new user
    const encryptionKey = getDbEncryptionKey();
    const result = await db.query(
      `INSERT INTO users (email, password_hash, role, full_name_enc, consent_given)
       VALUES ($1, $2, $3, pgp_sym_encrypt($4, $6), $5)
       RETURNING id, email, role, pgp_sym_decrypt(full_name_enc, $6)::text AS full_name, created_at`,
      [email.toLowerCase(), passwordHash, role, full_name, consent_given, encryptionKey]
    );

    const user = result.rows[0];

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.email, user.role);
    const refreshToken = generateRefreshToken();

    // Store hashed refresh token
    await storeRefreshToken(user.id, refreshToken);

    // Set refresh token cookie
    setRefreshTokenCookie(res, refreshToken);

    // Generate and set CSRF token
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    await logAuditEvent({
      actorId: user.id,
      action: 'REGISTER_SUCCESS',
      targetType: 'user',
      targetId: user.id,
      req,
      metadata: { role: user.role },
    });

    res.status(201).json({
      message: 'Registration successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
      },
      accessToken,
      csrfToken,
    });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({
      error: 'Registration failed. Please try again.',
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user and issue tokens
 * 
 * Security:
 * - Validates credentials
 * - Returns generic error message to prevent user enumeration
 * - Issues short-lived access token + refresh token rotation
 */
router.post('/login', validateRequest(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    // Fetch user by email
    const result = await db.query(
      `SELECT id, email, password_hash, role,
              pgp_sym_decrypt(full_name_enc, $2)::text AS full_name, is_suspended
       FROM users WHERE email = $1`,
      [email.toLowerCase(), getDbEncryptionKey()]
    );

    if (result.rows.length === 0) {
      await logAuditEvent({
        action: 'LOGIN_FAILED',
        targetType: 'auth',
        targetId: 'login',
        req,
        metadata: { reason: 'invalid_credentials' },
      });
      return res.status(401).json({
        error: 'Invalid email or password',
      });
    }

    const user = result.rows[0];

    // Check if account is suspended
    if (user.is_suspended) {
      await logAuditEvent({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        targetType: 'auth',
        targetId: 'login',
        req,
        metadata: { reason: 'suspended_account' },
      });
      console.warn('🚫 Suspended user login attempt', {
        userId: user.id,
      });
      return res.status(403).json({
        error: 'Account suspended. Contact administrator.',
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      await logAuditEvent({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        targetType: 'auth',
        targetId: 'login',
        req,
        metadata: { reason: 'invalid_credentials' },
      });
      return res.status(401).json({
        error: 'Invalid email or password',
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.email, user.role);
    const refreshToken = generateRefreshToken();

    // Store hashed refresh token
    await storeRefreshToken(user.id, refreshToken);

    // Set refresh token cookie
    setRefreshTokenCookie(res, refreshToken);

    // Generate and set CSRF token
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    await logAuditEvent({
      actorId: user.id,
      action: 'LOGIN_SUCCESS',
      targetType: 'user',
      targetId: user.id,
      req,
      metadata: { role: user.role },
    });

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
      },
      accessToken,
      csrfToken,
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({
      error: 'Login failed. Please try again.',
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token rotation
 * 
 * Security:
 * - Validates refresh token from httpOnly cookie
 * - Revokes used token and issues new pair
 * - If revoked token is reused, revoke ALL user tokens (compromise detection)
 */
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      await logAuditEvent({
        action: 'TOKEN_REFRESH_FAILED',
        targetType: 'auth',
        targetId: 'refresh',
        req,
        metadata: { reason: 'missing_token' },
      });
      return res.status(401).json({
        error: 'Refresh token required',
      });
    }

    const tokenHash = hashRefreshToken(refreshToken);

    // Fetch refresh token from database
    const result = await db.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked, 
              u.email, u.role, u.is_suspended
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      clearRefreshTokenCookie(res);
      await logAuditEvent({
        action: 'TOKEN_REFRESH_FAILED',
        targetType: 'auth',
        targetId: 'refresh',
        req,
        metadata: { reason: 'invalid_token' },
      });
      return res.status(401).json({
        error: 'Invalid refresh token',
      });
    }

    const tokenData = result.rows[0];

    // Check if token is expired
    if (new Date(tokenData.expires_at) < new Date()) {
      await db.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenData.id]);
      clearRefreshTokenCookie(res);
      await logAuditEvent({
        actorId: tokenData.user_id,
        action: 'TOKEN_REFRESH_FAILED',
        targetType: 'user',
        targetId: tokenData.user_id,
        req,
        metadata: { reason: 'expired_token' },
      });
      return res.status(401).json({
        error: 'Refresh token expired',
      });
    }

    // SECURITY: Detect refresh token reuse (possible compromise)
    if (tokenData.revoked) {
      await logAuditEvent({
        actorId: tokenData.user_id,
        action: 'TOKEN_REUSE_DETECTED',
        targetType: 'user',
        targetId: tokenData.user_id,
        req,
      });

      // Revoke ALL refresh tokens for this user
      await db.query(
        'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
        [tokenData.user_id]
      );

      clearRefreshTokenCookie(res);

      return res.status(401).json({
        error: 'Token reuse detected. All sessions revoked. Please login again.',
      });
    }

    // Check if user is suspended
    if (tokenData.is_suspended) {
      await db.query(
        'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
        [tokenData.user_id]
      );
      clearRefreshTokenCookie(res);
      await logAuditEvent({
        actorId: tokenData.user_id,
        action: 'TOKEN_REFRESH_FAILED',
        targetType: 'user',
        targetId: tokenData.user_id,
        req,
        metadata: { reason: 'suspended_account' },
      });
      return res.status(403).json({
        error: 'Account suspended. Contact administrator.',
      });
    }

    // Revoke current refresh token (rotation)
    await db.query(
      'UPDATE refresh_tokens SET revoked = true WHERE id = $1',
      [tokenData.id]
    );

    // Generate new token pair
    const newAccessToken = generateAccessToken(
      tokenData.user_id,
      tokenData.email,
      tokenData.role
    );
    const newRefreshToken = generateRefreshToken();

    // Store new refresh token
    await storeRefreshToken(tokenData.user_id, newRefreshToken);

    // Set new refresh token cookie
    setRefreshTokenCookie(res, newRefreshToken);

    // Generate and set new CSRF token
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
    await logAuditEvent({
      actorId: tokenData.user_id,
      action: 'TOKEN_REFRESHED',
      targetType: 'user',
      targetId: tokenData.user_id,
      req,
    });

    res.json({
      message: 'Token refreshed successfully',
      accessToken: newAccessToken,
      csrfToken,
    });
  } catch (error) {
    console.error('Token refresh error:', error.message);
    clearRefreshTokenCookie(res);
    res.status(500).json({
      error: 'Token refresh failed',
    });
  }
});

/**
 * POST /api/auth/logout
 * Revoke refresh token and clear cookie
 * Requires valid access token
 */
router.post('/logout', verifyToken, async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);

      // Revoke the refresh token
      await db.query(
        'UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1',
        [tokenHash]
      );
    }

    // Clear cookie
    clearRefreshTokenCookie(res);

    await logAuditEvent({
      actorId: req.user.userId,
      action: 'LOGOUT_SUCCESS',
      targetType: 'user',
      targetId: req.user.userId,
      req,
    });

    res.json({
      message: 'Logout successful',
    });
  } catch (error) {
    console.error('Logout error:', error.message);
    clearRefreshTokenCookie(res);
    res.status(500).json({
      error: 'Logout failed',
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile (requires authentication)
 */
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, role,
              pgp_sym_decrypt(full_name_enc, $2)::text AS full_name,
              consent_given, created_at
       FROM users WHERE id = $1`,
      [req.user.userId, getDbEncryptionKey()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    res.json({
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Get user profile error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch user profile',
    });
  }
});

export default router;
