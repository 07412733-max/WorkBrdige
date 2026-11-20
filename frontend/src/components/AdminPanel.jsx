import { useState, useEffect } from 'react';
import { admin } from '../api/client';

/**
 * AdminPanel Component
 * User and job moderation for administrators
 */
export default function AdminPanel() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [view, setView] = useState('stats');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (view === 'stats') fetchStats();
    if (view === 'users') fetchUsers();
    if (view === 'jobs') fetchJobs();
    if (view === 'audit') fetchAuditLogs();
  }, [view]);

  const fetchStats = async () => {
    try {
      const { data } = await admin.getStats();
      setStats(data);
    } catch (err) {
      setError('Failed to load statistics');
    }
  };

  const fetchUsers = async () => {
    try {
      const { data } = await admin.getUsers();
      setUsers(data.users);
    } catch (err) {
      setError('Failed to load users');
    }
  };

  const fetchJobs = async () => {
    try {
      const { data } = await admin.getJobs();
      setJobs(data.jobs);
    } catch (err) {
      setError('Failed to load jobs');
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const { data } = await admin.getAuditLogs();
      setAuditLogs(data.auditLogs);
    } catch (err) {
      setError('Failed to load audit logs');
    }
  };

  const handleSuspendUser = async (userId, suspend) => {
    try {
      await admin.suspendUser(userId, suspend);
      setSuccess(`User ${suspend ? 'suspended' : 'unsuspended'} successfully!`);
      fetchUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update user status');
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;

    try {
      await admin.deleteUser(userId);
      setSuccess('User deleted successfully!');
      fetchUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete user');
    }
  };

  const handleDeleteJob = async (jobId) => {
    if (!confirm('Are you sure you want to delete this job listing?')) return;

    try {
      await admin.deleteJob(jobId);
      setSuccess('Job deleted successfully!');
      fetchJobs();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to delete job');
    }
  };

  return (
    <div style={styles.container}>
      <h1>Admin Panel</h1>

      {/* Navigation Tabs */}
      <div style={styles.tabs}>
        <button
          onClick={() => setView('stats')}
          style={view === 'stats' ? styles.activeTab : styles.tab}
        >
          Statistics
        </button>
        <button
          onClick={() => setView('users')}
          style={view === 'users' ? styles.activeTab : styles.tab}
        >
          Users
        </button>
        <button
          onClick={() => setView('jobs')}
          style={view === 'jobs' ? styles.activeTab : styles.tab}
        >
          Jobs
        </button>
        <button
          onClick={() => setView('audit')}
          style={view === 'audit' ? styles.activeTab : styles.tab}
        >
          Audit Logs
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {success && <div style={styles.success}>{success}</div>}

      {/* Statistics View */}
      {view === 'stats' && stats && (
        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <h3>Users</h3>
            <p style={styles.statNumber}>{stats.users.total_users}</p>
            <div style={styles.statDetails}>
              <span>Job Seekers: {stats.users.job_seekers}</span>
              <span>Employers: {stats.users.employers}</span>
              <span>Admins: {stats.users.admins}</span>
              <span style={styles.suspended}>Suspended: {stats.users.suspended_users}</span>
            </div>
          </div>

          <div style={styles.statCard}>
            <h3>Jobs</h3>
            <p style={styles.statNumber}>{stats.jobs.total_jobs}</p>
            <div style={styles.statDetails}>
              <span>Open: {stats.jobs.open_jobs}</span>
              <span>Closed: {stats.jobs.closed_jobs}</span>
            </div>
          </div>

          <div style={styles.statCard}>
            <h3>Applications</h3>
            <p style={styles.statNumber}>{stats.applications.total_applications}</p>
            <div style={styles.statDetails}>
              <span>Pending: {stats.applications.pending}</span>
              <span>Reviewed: {stats.applications.reviewed}</span>
              <span>Accepted: {stats.applications.accepted}</span>
              <span>Rejected: {stats.applications.rejected}</span>
            </div>
          </div>
        </div>
      )}

      {/* Users View */}
      {view === 'users' && (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.full_name}</td>
                  <td>{user.email}</td>
                  <td>
                    <span style={styles.roleBadge}>{user.role}</span>
                  </td>
                  <td>
                    {user.is_suspended ? (
                      <span style={styles.suspendedBadge}>Suspended</span>
                    ) : (
                      <span style={styles.activeBadge}>Active</span>
                    )}
                  </td>
                  <td>
                    <div style={styles.actions}>
                      <button
                        onClick={() => handleSuspendUser(user.id, !user.is_suspended)}
                        style={user.is_suspended ? styles.unsuspendButton : styles.suspendButton}
                      >
                        {user.is_suspended ? 'Unsuspend' : 'Suspend'}
                      </button>
                      {user.role !== 'admin' && (
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          style={styles.deleteButton}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Jobs View */}
      {view === 'jobs' && (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Location</th>
                <th>Employer</th>
                <th>Status</th>
                <th>Applications</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.title}</td>
                  <td>{job.location}</td>
                  <td>{job.employer_name}</td>
                  <td>
                    <span style={job.status === 'open' ? styles.openBadge : styles.closedBadge}>
                      {job.status}
                    </span>
                  </td>
                  <td>{job.application_count}</td>
                  <td>
                    <button onClick={() => handleDeleteJob(job.id)} style={styles.deleteButton}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'audit' && (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Target</th>
                <th>IP</th>
                <th>Metadata</th>
                <th>Entry hash</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.created_at).toLocaleString()}</td>
                  <td>{event.action}</td>
                  <td>{event.actor_id || 'system'}</td>
                  <td>{event.target_type ? `${event.target_type}: ${event.target_id || ''}` : '-'}</td>
                  <td>{event.ip_address || '-'}</td>
                  <td>{JSON.stringify(event.metadata)}</td>
                  <td>{event.entry_hash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: '1200px', margin: '0 auto', padding: '20px' },
  tabs: { display: 'flex', gap: '10px', marginBottom: '30px', borderBottom: '2px solid #ddd' },
  tab: { padding: '10px 20px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#666', borderBottom: '3px solid transparent' },
  activeTab: { padding: '10px 20px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#007bff', borderBottom: '3px solid #007bff', fontWeight: 'bold' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginTop: '20px' },
  statCard: { backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' },
  statNumber: { fontSize: '36px', fontWeight: 'bold', color: '#007bff', margin: '10px 0' },
  statDetails: { display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '14px', color: '#666' },
  suspended: { color: '#dc3545', fontWeight: 'bold' },
  tableContainer: { backgroundColor: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  roleBadge: { padding: '4px 8px', backgroundColor: '#e9ecef', borderRadius: '4px', fontSize: '12px' },
  suspendedBadge: { padding: '4px 8px', backgroundColor: '#f8d7da', color: '#721c24', borderRadius: '4px', fontSize: '12px' },
  activeBadge: { padding: '4px 8px', backgroundColor: '#d4edda', color: '#155724', borderRadius: '4px', fontSize: '12px' },
  openBadge: { padding: '4px 8px', backgroundColor: '#d4edda', color: '#155724', borderRadius: '4px', fontSize: '12px' },
  closedBadge: { padding: '4px 8px', backgroundColor: '#f8d7da', color: '#721c24', borderRadius: '4px', fontSize: '12px' },
  actions: { display: 'flex', gap: '5px' },
  suspendButton: { padding: '6px 12px', backgroundColor: '#ffc107', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  unsuspendButton: { padding: '6px 12px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  deleteButton: { padding: '6px 12px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  error: { backgroundColor: '#f8d7da', color: '#721c24', padding: '12px', borderRadius: '4px', marginBottom: '15px' },
  success: { backgroundColor: '#d4edda', color: '#155724', padding: '12px', borderRadius: '4px', marginBottom: '15px' },
};
