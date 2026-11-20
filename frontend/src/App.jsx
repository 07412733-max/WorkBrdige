import { useState, useEffect } from 'react';
import AuthForm from './components/AuthForm';
import JobBoard from './components/JobBoard';
import EmployerDashboard from './components/EmployerDashboard';
import AdminPanel from './components/AdminPanel';
import { setAccessToken, clearAccessToken, auth } from './api/client';

/**
 * Main App Component
 * Handles authentication state and role-based routing
 * 
 * Security:
 * - Access token stored in memory only (via api/client)
 * - Logout on auth:logout custom event (from token refresh failure)
 * - Role-based component rendering
 */
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try to restore session on mount
    restoreSession();

    // Listen for automatic logout events (from token refresh failure)
    const handleLogout = () => {
      handleLogoutClick();
    };

    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  const restoreSession = async () => {
    try {
      // Try to refresh token on mount (uses httpOnly cookie)
      const { data } = await auth.refresh();
      setAccessToken(data.accessToken);

      // Fetch user profile
      const profileResponse = await auth.getProfile();
      setUser(profileResponse.data.user);
    } catch (error) {
      // No valid session
      clearAccessToken();
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSuccess = (userData, accessToken) => {
    setAccessToken(accessToken);
    setUser(userData);
  };

  const handleLogoutClick = async () => {
    try {
      await auth.logout();
    } catch (error) {
      // Ignore logout errors
    } finally {
      clearAccessToken();
      setUser(null);
    }
  };

  if (loading) {
    return (
      <div style={styles.loading}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      {/* Header / Navigation */}
      {user && (
        <header style={styles.header}>
          <div style={styles.headerContent}>
            <h2 style={styles.logo}>WorkBridge</h2>
            <div style={styles.userInfo}>
              <span style={styles.userName}>
                {user.full_name} ({user.role.replace('_', ' ')})
              </span>
              <button onClick={handleLogoutClick} style={styles.logoutButton}>
                Logout
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main style={styles.main}>
        {!user ? (
          <AuthForm onSuccess={handleAuthSuccess} />
        ) : user.role === 'job_seeker' ? (
          <JobBoard user={user} />
        ) : user.role === 'employer' ? (
          <EmployerDashboard />
        ) : user.role === 'admin' ? (
          <AdminPanel />
        ) : (
          <div style={styles.error}>Invalid user role</div>
        )}
      </main>

      {/* Footer */}
      {!user && (
        <footer style={styles.footer}>
          <p>
            WorkBridge - Secure Job Board Platform | Built with security-first principles
          </p>
          <p style={styles.footerSmall}>
            RA 10173 Compliant | OWASP Best Practices
          </p>
        </footer>
      )}
    </div>
  );
}

const styles = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    borderBottom: '1px solid #ddd',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  headerContent: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '15px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: {
    margin: 0,
    color: '#007bff',
    fontSize: '24px',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  userName: {
    fontSize: '14px',
    color: '#666',
    textTransform: 'capitalize',
  },
  logoutButton: {
    padding: '8px 16px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  main: {
    flex: 1,
    width: '100%',
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    fontSize: '18px',
    color: '#666',
  },
  error: {
    maxWidth: '600px',
    margin: '50px auto',
    padding: '20px',
    backgroundColor: '#f8d7da',
    color: '#721c24',
    borderRadius: '8px',
    textAlign: 'center',
  },
  footer: {
    backgroundColor: '#fff',
    borderTop: '1px solid #ddd',
    padding: '30px 20px',
    textAlign: 'center',
    color: '#666',
    fontSize: '14px',
  },
  footerSmall: {
    fontSize: '12px',
    color: '#999',
    marginTop: '10px',
  },
};
