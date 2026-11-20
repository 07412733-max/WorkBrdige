import crypto from 'crypto';
import { logAuditEvent } from '../services/auditLogger.js';

/**
 * CSRF Protection Middleware
 * Implements Double-Submit Cookie pattern with SameSite=Strict
 * 
 * Security Strategy:
 * 1. Token generated on GET /api/auth/csrf-token (and on login/refresh)
 * 2. Token stored in non-httpOnly cookie 'wb_csrf' (readable by JavaScript)
 * 3. Client reads cookie and sends token in X-CSRF-Token header
 * 4. Server verifies cookie value matches header value using timing-safe comparison
 * 
 * Defense:
 * - SameSite=Strict prevents cookie from being sent in cross-origin requests
 * - Even if attacker tricks user into making request, they can't read cookie to set header
 * - Protects against CSRF attacks on state-changing operations
 */

/**
 * Generate a cryptographically secure CSRF token
 * @returns {string} 64-character hex string (32 random bytes)
 */
export const generateCsrfToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Set CSRF token in a non-httpOnly cookie
 * This allows JavaScript to read the token and send it in request headers
 * 
 * @param {Response} res - Express response object
 * @param {string} token - CSRF token to set
 */
export const setCsrfCookie = (res, token) => {
  res.cookie('wb_csrf', token, {
    httpOnly: false, // Must be readable by JavaScript
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict', // Strict CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (matches refresh token)
    path: '/', // Available on all routes
  });
};

/**
 * Clear CSRF token cookie
 * @param {Response} res - Express response object
 */
export const clearCsrfCookie = (res) => {
  res.clearCookie('wb_csrf', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
};

/**
 * Verify CSRF token using Double-Submit Cookie pattern
 * 
 * Middleware that enforces CSRF protection on state-changing requests.
 * Compares X-CSRF-Token header with wb_csrf cookie using timing-safe comparison.
 * 
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const verifyCsrf = async (req, res, next) => {
  // Only verify on state-changing methods
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  try {
    // Extract token from header
    const headerToken = req.get('X-CSRF-Token');
    
    // Extract token from cookie
    const cookieToken = req.cookies.wb_csrf;

    // Both must be present
    const validFormat =
      typeof headerToken === 'string' &&
      typeof cookieToken === 'string' &&
      /^[0-9a-f]{64}$/i.test(headerToken) &&
      /^[0-9a-f]{64}$/i.test(cookieToken);
    const isValid =
      validFormat &&
      headerToken.length === cookieToken.length &&
      crypto.timingSafeEqual(
        Buffer.from(headerToken, 'utf8'),
        Buffer.from(cookieToken, 'utf8')
      );

    if (!isValid) {
      try {
        await logAuditEvent({
          actorId: req.user?.userId || null,
          action: 'CSRF_FAILED',
          targetType: 'request',
          targetId: req.path,
          req,
          metadata: {
            reason: !headerToken || !cookieToken ? 'missing_token' : 'mismatch',
            method: req.method,
            path: req.path,
          },
        });
      } catch (error) {
        console.error('CSRF audit logging failed:', error.message);
      }
      return res.status(403).json({
        error: 'Invalid or missing CSRF token',
      });
    }

    // CSRF token is valid, proceed
    next();
  } catch (error) {
    console.error('❌ CSRF verification error:', error.message);
    return res.status(500).json({
      error: 'Internal server error during CSRF verification',
    });
  }
};

/**
 * Optional: Skip CSRF verification for specific routes
 * Use sparingly and only for routes that have alternative protection
 * 
 * @param {Function} handler - Route handler to wrap
 * @returns {Function} Wrapped handler that bypasses CSRF check
 */
export const skipCsrf = (handler) => {
  return (req, res, next) => {
    req.skipCsrf = true;
    return handler(req, res, next);
  };
};
