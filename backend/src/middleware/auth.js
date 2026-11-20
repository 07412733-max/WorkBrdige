import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { logAuditEvent } from '../services/auditLogger.js';

/**
 * Verify JWT access token middleware
 * Extracts Bearer token from Authorization header and validates it
 * Attaches decoded user data to req.user
 */
export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Access denied. No token provided.' 
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token with pinned algorithm and issuer/audience validation
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'workbridge-api',
      audience: 'workbridge-client',
    });

    // Check if user still exists and is not suspended
    const result = await db.query(
      'SELECT id, email, role, is_suspended FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        error: 'Invalid token. User not found.' 
      });
    }

    const user = result.rows[0];

    if (user.is_suspended) {
      await logAuditEvent({
        actorId: user.id,
        action: 'AUTHORIZATION_DENIED',
        targetType: 'request',
        targetId: req.path,
        req,
        metadata: { role: user.role, reason: 'suspended_account', method: req.method, path: req.path },
      });
      return res.status(403).json({ 
        error: 'Account suspended. Contact administrator.' 
      });
    }

    // Attach user data to request
    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired. Please refresh your token.' 
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token.' 
      });
    }

    console.error('Token verification error:', error.message);
    return res.status(500).json({ 
      error: 'Internal server error during authentication.' 
    });
  }
};

/**
 * Role-Based Access Control (RBAC) middleware
 * Restricts route access to specific user roles
 * MUST be used after verifyToken middleware
 * 
 * @param {...string} allowedRoles - Roles that can access the route
 * @returns {Function} Express middleware
 * 
 * @example
 * router.get('/admin-only', verifyToken, authorizeRole('admin'), handler);
 * router.get('/employer-route', verifyToken, authorizeRole('employer', 'admin'), handler);
 */
export const authorizeRole = (...allowedRoles) => {
  return async (req, res, next) => {
    if (!req.user) {
      // This should never happen if verifyToken is used correctly
      console.error('⚠️ SECURITY: authorizeRole called without verifyToken');
      return res.status(500).json({ 
        error: 'Internal server error. Authentication required.' 
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      try {
        await logAuditEvent({
          actorId: req.user.userId,
          action: 'RBAC_DENIED',
          targetType: 'request',
          targetId: req.path,
          req,
          metadata: {
            role: req.user.role,
            requiredRoles: allowedRoles,
            path: req.path,
            method: req.method,
          },
        });
      } catch (error) {
        return next(error);
      }
      return res.status(403).json({ 
        error: 'Forbidden. Insufficient permissions.' 
      });
    }

    next();
  };
};

/**
 * Optional authentication middleware
 * Attaches user data if token is valid, but allows request to proceed without token
 * Useful for routes that have different behavior for authenticated vs. anonymous users
 */
export const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(); // No token, continue as anonymous
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'workbridge-api',
      audience: 'workbridge-client',
    });

    const result = await db.query(
      'SELECT id, email, role, is_suspended FROM users WHERE id = $1 AND is_suspended = false',
      [decoded.userId]
    );

    if (result.rows.length > 0) {
      req.user = {
        userId: result.rows[0].id,
        email: result.rows[0].email,
        role: result.rows[0].role,
      };
    }
  } catch (error) {
    // Token invalid or expired, continue as anonymous
    // Don't send error response, just ignore the token
  }

  next();
};
