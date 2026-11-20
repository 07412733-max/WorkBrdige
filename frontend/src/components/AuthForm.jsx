import { useState } from 'react';
import { auth } from '../api/client';

/**
 * AuthForm Component
 * Handles user registration and login with RA 10173 consent
 * 
 * Security:
 * - React auto-escapes all user inputs (XSS protection)
 * - Password requirements enforced client-side (server validates too)
 * - RA 10173 consent checkbox required for registration
 */
export default function AuthForm({ onSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    role: 'job_seeker',
    full_name: '',
    consent_given: false,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = isLogin
        ? { email: formData.email, password: formData.password }
        : formData;

      const { data } = isLogin
        ? await auth.login(payload)
        : await auth.register(payload);
      onSuccess(data.user, data.accessToken);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>{isLogin ? 'Login' : 'Sign Up'}</h2>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={formData.email}
            onChange={handleChange}
            required
            style={styles.input}
          />

          <input
            type="password"
            name="password"
            placeholder="Password"
            value={formData.password}
            onChange={handleChange}
            required
            minLength={8}
            style={styles.input}
          />

          {!isLogin && (
            <>
              <input
                type="text"
                name="full_name"
                placeholder="Full Name"
                value={formData.full_name}
                onChange={handleChange}
                required
                style={styles.input}
              />

              <select
                name="role"
                value={formData.role}
                onChange={handleChange}
                required
                style={styles.input}
              >
                <option value="job_seeker">Job Seeker</option>
                <option value="employer">Employer</option>
              </select>

              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  name="consent_given"
                  checked={formData.consent_given}
                  onChange={handleChange}
                  required
                  style={styles.checkbox}
                />
                <span style={styles.consentText}>
                  I consent to the collection and processing of my personal data in accordance with{' '}
                  <strong>RA 10173 (Data Privacy Act of 2012)</strong>
                </span>
              </label>
            </>
          )}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Processing...' : isLogin ? 'Login' : 'Sign Up'}
          </button>
        </form>

        <p style={styles.toggle}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            style={styles.toggleButton}
          >
            {isLogin ? 'Sign Up' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    padding: '20px',
  },
  card: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    width: '100%',
    maxWidth: '450px',
  },
  title: {
    textAlign: 'center',
    marginBottom: '30px',
    color: '#333',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  input: {
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  button: {
    padding: '12px',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '16px',
    cursor: 'pointer',
    marginTop: '10px',
  },
  error: {
    backgroundColor: '#f8d7da',
    color: '#721c24',
    padding: '12px',
    borderRadius: '4px',
    marginBottom: '15px',
    border: '1px solid #f5c6cb',
  },
  toggle: {
    textAlign: 'center',
    marginTop: '20px',
    color: '#666',
  },
  toggleButton: {
    background: 'none',
    border: 'none',
    color: '#007bff',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    fontSize: '13px',
    color: '#555',
  },
  checkbox: {
    marginTop: '3px',
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  consentText: {
    lineHeight: '1.5',
  },
};
