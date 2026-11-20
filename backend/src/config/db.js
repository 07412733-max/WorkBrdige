import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const useSsl = process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true';

// PostgreSQL connection pool with parameterized query support
// Uses least-privilege workbridge_app role (no DDL permissions)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on('connect', () => {
  console.log('✅ Database connected successfully');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  process.exit(-1);
});

/**
 * Execute parameterized query (prevents SQL injection)
 * @param {string} text - SQL query with $1, $2, ... placeholders
 * @param {Array} params - Values for placeholders
 * @returns {Promise<Object>} Query result
 */
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    // Log slow queries (> 100ms) for performance monitoring
    if (duration > 100) {
      console.warn(`⚠️ Slow query (${duration}ms):`, text.substring(0, 100));
    }
    
    return res;
  } catch (error) {
    console.error('Database query error:', {
      message: error.message,
      query: text.substring(0, 100), // Log partial query for debugging
      // Never log params in production (may contain sensitive data)
    });
    throw error;
  }
};

/**
 * Get a client from the pool for transactions
 * @returns {Promise<PoolClient>}
 */
export const getClient = async () => {
  return await pool.connect();
};

/**
 * Graceful shutdown handler
 */
export const closePool = async () => {
  await pool.end();
  console.log('🔌 Database pool closed');
};

export default {
  query,
  getClient,
  closePool,
};
