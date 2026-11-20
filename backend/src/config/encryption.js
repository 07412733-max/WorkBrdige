export const getDbEncryptionKey = () => {
  const key = process.env.DB_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('DB_ENCRYPTION_KEY is required for encrypted personal data');
  }
  if (key === process.env.JWT_ACCESS_SECRET || key === process.env.JWT_REFRESH_SECRET) {
    throw new Error('DB_ENCRYPTION_KEY must be different from JWT signing secrets');
  }
  return key;
};

export const getFileEncryptionKey = () => {
  const value = process.env.FILE_ENCRYPTION_KEY;
  if (!value) {
    throw new Error('FILE_ENCRYPTION_KEY is required for resume encryption');
  }

  let key;
  if (/^[0-9a-f]{64}$/i.test(value)) {
    key = Buffer.from(value, 'hex');
  } else {
    key = Buffer.from(value, 'base64');
  }

  if (key.length !== 32) {
    throw new Error('FILE_ENCRYPTION_KEY must encode exactly 32 bytes as hex or base64');
  }
  return key;
};
