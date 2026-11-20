import { z } from 'zod';

/**
 * Zod validation middleware factory
 * Validates request body against a Zod schema and rejects unexpected keys
 * 
 * @param {z.ZodSchema} schema - Zod validation schema
 * @returns {Function} Express middleware
 * 
 * Security Features:
 * - Uses .strict() to reject unknown keys (prevents prototype pollution)
 * - Returns 400 with detailed validation errors
 * - Sanitizes error messages to avoid information leakage
 */
export const validateRequest = (schema) => {
  return (req, res, next) => {
    try {
      // Parse and validate request body
      // .strict() ensures no unexpected properties are allowed
      const validated = schema.strict().parse(req.body);
      
      // Replace req.body with validated data
      req.body = validated;
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Format validation errors for client
        const errors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        return res.status(400).json({
          error: 'Validation failed',
          details: errors,
        });
      }

      // Unexpected error during validation
      console.error('Validation middleware error:', error);
      return res.status(500).json({
        error: 'Internal server error during validation',
      });
    }
  };
};

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

/**
 * User Registration Schema
 * Enforces strong password, valid email, and RA 10173 consent
 */
export const registerSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email too long'),
  
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password too long')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      'Password must contain uppercase, lowercase, number, and special character'
    ),
  
  role: z.enum(['job_seeker', 'employer'], {
    errorMap: () => ({ message: 'Role must be job_seeker or employer' })
  }),
  
  full_name: z.string()
    .min(2, 'Full name must be at least 2 characters')
    .max(255, 'Full name too long')
    .regex(/^[a-zA-Z\s\-'\.]+$/, 'Full name contains invalid characters'),
  
  consent_given: z.boolean()
    .refine((val) => val === true, {
      message: 'You must consent to data processing (RA 10173 compliance)'
    }),
});

/**
 * Login Schema
 */
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password required'),
});

/**
 * Job Listing Creation Schema
 */
export const createJobSchema = z.object({
  title: z.string()
    .min(5, 'Title must be at least 5 characters')
    .max(255, 'Title too long'),
  
  description: z.string()
    .min(20, 'Description must be at least 20 characters')
    .max(5000, 'Description too long'),
  
  location: z.string()
    .min(2, 'Location must be at least 2 characters')
    .max(255, 'Location too long'),
  
  salary_range: z.string()
    .max(100, 'Salary range too long')
    .optional(),
});

/**
 * Job Listing Update Schema (partial)
 */
export const updateJobSchema = z.object({
  title: z.string()
    .min(5, 'Title must be at least 5 characters')
    .max(255, 'Title too long')
    .optional(),
  
  description: z.string()
    .min(20, 'Description must be at least 20 characters')
    .max(5000, 'Description too long')
    .optional(),
  
  location: z.string()
    .min(2, 'Location must be at least 2 characters')
    .max(255, 'Location too long')
    .optional(),
  
  salary_range: z.string()
    .max(100, 'Salary range too long')
    .optional(),
  
  status: z.enum(['open', 'closed'], {
    errorMap: () => ({ message: 'Status must be open or closed' })
  }).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

/**
 * Job Application Schema
 */
export const createApplicationSchema = z.object({
  cover_letter: z.string()
    .max(2000, 'Cover letter too long')
    .optional(),
  applicant_phone: z.string()
    .max(32, 'Phone number too long')
    .optional(),
});

/**
 * Application Status Update Schema
 */
export const updateApplicationStatusSchema = z.object({
  status: z.enum(['pending', 'reviewed', 'accepted', 'rejected'], {
    errorMap: () => ({ message: 'Invalid application status' })
  }),
});

/**
 * User Suspension Schema
 */
export const suspendUserSchema = z.object({
  is_suspended: z.boolean(),
});

/**
 * UUID validation helper
 */
export const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};
