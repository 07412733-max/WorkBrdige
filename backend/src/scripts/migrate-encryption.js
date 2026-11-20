import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDbEncryptionKey } from '../config/encryption.js';
import { decryptFile, encryptFile } from '../services/fileEncryption.js';

dotenv.config();

const { Pool } = pg;
const useSsl = process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
});
const encryptionKey = getDbEncryptionKey();
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(scriptDir, '../../uploads');

const getColumns = async (client, table) => {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const migrateLegacyColumns = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userColumns = await getColumns(client, 'users');
    if (userColumns.has('full_name')) {
      await client.query(
        `UPDATE users
         SET full_name_enc = pgp_sym_encrypt(full_name, $1)
         WHERE full_name IS NOT NULL AND full_name_enc IS NULL`,
        [encryptionKey]
      );
      await client.query('UPDATE users SET full_name = NULL WHERE full_name IS NOT NULL');
      await client.query('ALTER TABLE users ALTER COLUMN full_name DROP NOT NULL');
    }

    const applicationColumns = await getColumns(client, 'applications');
    if (applicationColumns.has('cover_letter')) {
      await client.query(
        `UPDATE applications
         SET cover_note = pgp_sym_encrypt(cover_letter, $1)
         WHERE cover_letter IS NOT NULL AND cover_note IS NULL`,
        [encryptionKey]
      );
      await client.query(
        'UPDATE applications SET cover_letter = NULL WHERE cover_letter IS NOT NULL'
      );
      await client.query('ALTER TABLE applications ALTER COLUMN cover_letter DROP NOT NULL');
    }

    await client.query('ALTER TABLE users ALTER COLUMN full_name_enc SET NOT NULL');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const migrateLegacyResumes = async () => {
  await fs.promises.mkdir(uploadDir, { recursive: true, mode: 0o700 });
  const entries = await fs.promises.readdir(uploadDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f-]{36}\.pdf$/i.test(entry.name)) continue;

    const oldPath = path.join(uploadDir, entry.name);
    const encryptedPath = `${oldPath}.enc`;
    const original = await fs.promises.readFile(oldPath);

    if (fs.existsSync(encryptedPath)) {
      const existingPlaintext = decryptFile(await fs.promises.readFile(encryptedPath));
      if (!existingPlaintext.equals(original)) {
        throw new Error(`Encrypted resume does not match legacy file: ${entry.name}`);
      }
    } else {
      const encrypted = encryptFile(original);
      await fs.promises.writeFile(encryptedPath, encrypted, { flag: 'wx', mode: 0o600 });
      const verified = decryptFile(await fs.promises.readFile(encryptedPath));
      if (!verified.equals(original)) {
        throw new Error(`Resume encryption verification failed: ${entry.name}`);
      }
    }

    await fs.promises.unlink(oldPath);
    console.log(`Encrypted legacy resume: ${entry.name}`);
  }
};

try {
  await migrateLegacyColumns();
  await migrateLegacyResumes();
  console.log('Encryption migration completed successfully.');
} catch (error) {
  console.error('Encryption migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
