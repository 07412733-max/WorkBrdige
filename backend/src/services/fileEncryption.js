import crypto from 'crypto';
import { getFileEncryptionKey } from '../config/encryption.js';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export const encryptFile = (plaintext) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', getFileEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
};

export const decryptFile = (encrypted) => {
  if (encrypted.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error('Encrypted resume has an invalid format');
  }

  const iv = encrypted.subarray(0, IV_LENGTH);
  const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getFileEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};
