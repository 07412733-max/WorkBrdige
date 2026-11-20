import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { decryptFile, encryptFile } from '../services/fileEncryption.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Upload directory (outside web root for security)
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
}

/**
 * Multer configuration for secure PDF uploads
 * Uses memory storage to validate file before saving
 */
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB max file size
    files: 1, // Only one file per request
  },
  fileFilter: (req, file, cb) => {
    // Initial MIME type check (can be spoofed, verified later)
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'), false);
    }
    cb(null, true);
  },
});

/**
 * PDF Magic Byte Validation Middleware
 * Verifies the file is actually a PDF by checking the first 5 bytes
 * Must be used after multer middleware
 * 
 * Security: Prevents extension/MIME spoofing attacks
 * PDF files start with: %PDF- (0x25 0x50 0x44 0x46 0x2D)
 */
export const validatePdfMagicBytes = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'No file uploaded',
    });
  }

  const buffer = req.file.buffer;

  // Check minimum size
  if (buffer.length < 5) {
    return res.status(415).json({
      error: 'Invalid PDF file: file too small',
    });
  }

  // Verify PDF magic bytes: %PDF-
  const magicBytes = buffer.slice(0, 5);
  const expectedMagicBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]); // %PDF-

  if (!magicBytes.equals(expectedMagicBytes)) {
    console.warn('⚠️ SECURITY: Invalid PDF magic bytes detected', {
      userId: req.user?.userId,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      actualBytes: magicBytes.toString('hex'),
    });

    return res.status(415).json({
      error: 'Invalid PDF file: file signature does not match PDF format',
    });
  }

  next();
};

/**
 * Save validated PDF to disk with secure UUID filename
 * Must be used after validatePdfMagicBytes
 * 
 * Security features:
 * - UUID filename prevents path traversal
 * - 0o600 permissions (owner read/write only)
 * - Stored outside web root
 * - Original filename discarded
 * 
 * @returns {Promise<string>} UUID of saved file (without extension)
 */
export const savePdfSecurely = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file to save',
      });
    }

    // Generate unique filename
    const fileUuid = crypto.randomUUID();
    const filename = `${fileUuid}.pdf.enc`;
    const filepath = path.join(UPLOAD_DIR, filename);
    const encryptedBuffer = encryptFile(req.file.buffer);

    // Write file with restricted permissions
    await fs.promises.writeFile(filepath, encryptedBuffer, {
      mode: 0o600, // Owner read/write only
      flag: 'wx',
    });

    // Verify file was created
    const stats = await fs.promises.stat(filepath);
    if (!stats.isFile()) {
      throw new Error('File was not created successfully');
    }

    // Attach UUID to request for use in route handler
    req.resumeUuid = fileUuid;

    // Clean up buffer from memory
    req.file.buffer = null;

    console.log('✅ PDF saved securely', {
      uuid: fileUuid,
      size: stats.size,
      userId: req.user?.userId,
    });

    next();
  } catch (error) {
    console.error('Error saving PDF:', error.message);
    return res.status(500).json({
      error: 'Failed to save uploaded file',
    });
  }
};

/**
 * Combined middleware for PDF upload pipeline
 * Use this on routes that accept PDF uploads
 */
export const uploadPdfPipeline = [
  upload.single('resume'), // Multer handles multipart/form-data
  validatePdfMagicBytes,   // Verify PDF signature
  savePdfSecurely,         // Save with UUID and restricted permissions
];

/**
 * Serve PDF file securely to authorized users
 * Should be used with RBAC middleware to check permissions
 * 
 * @param {string} resumeUuid - UUID of the resume file
 * @param {Object} res - Express response object
 */
export const servePdfSecurely = async (resumeUuid, res) => {
  try {
    // Validate UUID format to prevent path traversal
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(resumeUuid)) {
      return res.status(400).json({
        error: 'Invalid resume ID',
      });
    }

    const filename = `${resumeUuid}.pdf.enc`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Check if file exists
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({
        error: 'Resume not found',
      });
    }

    const encrypted = await fs.promises.readFile(filepath);
    const plaintext = decryptFile(encrypted);

    // Set security headers after successful decryption.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="resume.pdf"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

    res.setHeader('Content-Length', plaintext.length);
    res.end(plaintext);
  } catch (error) {
    console.error('Error serving PDF:', error.message);
    return res.status(500).json({
      error: 'Failed to retrieve resume',
    });
  }
};

export default {
  uploadPdfPipeline,
  validatePdfMagicBytes,
  savePdfSecurely,
  servePdfSecurely,
};
