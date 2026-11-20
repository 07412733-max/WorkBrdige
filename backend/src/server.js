import express from 'express';
import https from 'https';
import fs from 'fs';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import db, { closePool } from './config/db.js';
import authRoutes from './routes/auth.routes.js';
import jobsRoutes from './routes/jobs.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { verifyCsrf } from './middleware/csrf.js';
import { logAuditEvent } from './services/auditLogger.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      return next();
    }
    if (!req.headers.host) {
      return res.status(400).json({ error: 'Host header required for HTTPS redirect' });
    }
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  });
}

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

/**
 * Helmet - Security headers
 * Sets various HTTP headers to protect against common vulnerabilities
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for React
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"], // Prevent clickjacking
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
    noSniff: true, // X-Content-Type-Options: nosniff
    xssFilter: true, // X-XSS-Protection: 1; mode=block
  })
);

// Remove X-Powered-By header to avoid exposing Express
app.disable('x-powered-by');

/**
 * CORS Configuration
 * Explicit allowlist of origins with credentials support
 * NEVER use wildcard (*) in production
 */
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : ['http://localhost:5173'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn('🚫 CORS: Blocked request from unauthorized origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true, // Allow cookies to be sent
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 600, // Cache preflight for 10 minutes
  })
);

/**
 * Rate Limiting
 * Prevents brute force and DoS attacks
 */

// Strict rate limit for authentication routes
const authLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds
  max: 5,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: async (req, res) => {
    try {
      await logAuditEvent({
        action: 'RATE_LIMIT_EXCEEDED',
        targetType: 'request',
        targetId: req.path,
        req,
        metadata: { endpoint: req.path, method: req.method },
      });
    } catch (error) {
      console.error('Rate-limit audit logging failed:', error.message);
    }
    res.status(429).json({
      error: 'Too many authentication attempts. Try again in 10 seconds.',
    });
  },
});

// General rate limit for job routes
const jobsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests per window
  message: {
    error: 'Too many requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn('⚠️ RATE LIMIT: Jobs route exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Too many requests. Please try again later.',
    });
  },
});

// General rate limit for admin routes
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Cookie parser for refresh tokens
 */
app.use(cookieParser());

// Enforce CSRF checks on every state-changing API method, including auth routes.
app.use('/api', verifyCsrf);

// Apply auth limits before parsing request bodies.
app.post('/api/auth/login', authLimiter);
app.post('/api/auth/register', authLimiter);
app.post('/api/auth/refresh', authLimiter);

/**
 * Body parsing middleware
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Request logging (development only)
 */
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await db.query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
    });
  }
});

/**
 * API Routes with rate limiting and CSRF protection
 */
app.use('/api/auth', authRoutes);

app.use('/api/jobs', jobsLimiter, jobsRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);

/**
 * Root endpoint
 */
app.get('/', (req, res) => {
  res.json({
    name: 'WorkBridge API',
    version: '1.0.0',
    description: 'Secure Job Board Platform API',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      jobs: '/api/jobs',
      admin: '/api/admin',
    },
    documentation: 'See README.md for API documentation',
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
  });
});

/**
 * Global error handler
 * Catches all errors and prevents stack trace leakage in production
 */
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  // Handle specific error types
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Invalid or expired token',
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Invalid JSON payload',
    });
  }

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'CORS policy violation',
    });
  }

  // Generic error response (don't leak internal details)
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

/**
 * Start server
 */
const keyPath = process.env.SSL_KEY_PATH;
const certPath = process.env.SSL_CERT_PATH;
let listener = app;
const tlsFilesExist =
  keyPath &&
  certPath &&
  fs.existsSync(keyPath) &&
  fs.existsSync(certPath);

if (tlsFilesExist) {
  listener = https.createServer(
    {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    },
    app
  );
} else if (process.env.NODE_ENV === 'production' && (keyPath || certPath)) {
  throw new Error('Both SSL_KEY_PATH and SSL_CERT_PATH must point to readable files');
} else if (keyPath || certPath) {
  console.warn('Local HTTPS certificate files are incomplete; serving HTTP instead.');
}

const server = listener.listen(PORT, () => {
  const protocol = tlsFilesExist ? 'https' : 'http';
  console.log('\n🚀 WorkBridge API Server Started');
  console.log('================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Port: ${PORT}`);
  console.log(`URL: ${protocol}://localhost:${PORT}`);
  console.log(`Health: ${protocol}://localhost:${PORT}/health`);
  console.log('================================\n');
});

/**
 * Graceful shutdown handler
 * Closes database connections and server cleanly
 */
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('✅ HTTP server closed');

    try {
      // Close database pool
      await closePool();
      console.log('✅ Database connections closed');

      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error.message);
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('❌ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error);
  gracefulShutdown('UNCAUGHT EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION:', reason);
  gracefulShutdown('UNHANDLED REJECTION');
});

export default app;
