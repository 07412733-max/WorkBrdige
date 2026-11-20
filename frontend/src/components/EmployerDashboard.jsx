import { useState, useEffect } from 'react';
import { employer } from '../api/client';

/**
 * EmployerDashboard Component
 * Job creation and application management for employers
 */
export default function EmployerDashboard() {
  const [jobs, setJobs] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location: '',
    salary_range: '',
  });
  const [selectedJobApplications, setSelectedJobApplications] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const { data } = await employer.getJobs();
      setJobs(data.jobs);
    } catch (err) {
      setError('Failed to load your jobs');
    }
  };

  const handleCreateJob = async (e) => {
    e.preventDefault();
    setError('');

    try {
      await employer.createJob(formData);
      setSuccess('Job created successfully!');
      setShowCreateForm(false);
      setFormData({ title: '', description: '', location: '', salary_range: '' });
      fetchJobs();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      // Show detailed validation errors if available
      if (err.response?.data?.details) {
        const errorMessages = err.response.data.details.map(d => `${d.field}: ${d.message}`).join(', ');
        setError(`Validation failed: ${errorMessages}`);
      } else {
        setError(err.response?.data?.error || 'Failed to create job');
      }
    }
  };

  const handleDeleteJob = async (jobId) => {
    if (!confirm('Are you sure you want to delete this job?')) return;

    try {
      await employer.deleteJob(jobId);
      setSuccess('Job deleted successfully!');
      fetchJobs();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to delete job');
    }
  };

  const viewApplications = async (jobId) => {
    try {
      const { data } = await employer.getApplications(jobId);
      setSelectedJobApplications({ jobId, applications: data.applications });
    } catch (err) {
      setError('Failed to load applications');
    }
  };

  const updateApplicationStatus = async (applicationId, status) => {
    try {
      await employer.updateApplicationStatus(applicationId, status);
      // Refresh applications
      viewApplications(selectedJobApplications.jobId);
      setSuccess('Application status updated!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to update application status');
    }
  };

  const downloadResume = async (applicationId, applicantName) => {
    try {
      const { data } = await employer.downloadResume(applicationId);
      const url = window.URL.createObjectURL(new Blob([data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `resume_${applicantName}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError('Failed to download resume');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1>Employer Dashboard</h1>
        <button onClick={() => setShowCreateForm(true)} style={styles.createButton}>
          + Create Job
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {success && <div style={styles.success}>{success}</div>}

      {/* Job Listings */}
      <div style={styles.jobsList}>
        {jobs.length === 0 ? (
          <p style={styles.noJobs}>No jobs posted yet. Create your first job!</p>
        ) : (
          jobs.map((job) => (
            <div key={job.id} style={styles.jobCard}>
              <h3>{job.title}</h3>
              <p style={styles.location}>📍 {job.location}</p>
              <p style={styles.applications}>
                {job.application_count} application(s)
              </p>
              <div style={styles.jobActions}>
                <button onClick={() => viewApplications(job.id)} style={styles.viewButton}>
                  View Applications
                </button>
                <button onClick={() => handleDeleteJob(job.id)} style={styles.deleteButton}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Job Modal */}
      {showCreateForm && (
        <div style={styles.modal} onClick={() => setShowCreateForm(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2>Create New Job</h2>
            <form onSubmit={handleCreateJob} style={styles.form}>
              <input
                type="text"
                placeholder="Job Title (minimum 5 characters)"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
                style={styles.input}
              />
              <textarea
                placeholder="Job Description (minimum 20 characters)"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                required
                rows={6}
                style={styles.textarea}
              />
              <input
                type="text"
                placeholder="Location (minimum 2 characters)"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                required
                style={styles.input}
              />
              <input
                type="text"
                placeholder="Salary Range (optional)"
                value={formData.salary_range}
                onChange={(e) => setFormData({ ...formData, salary_range: e.target.value })}
                style={styles.input}
              />
              <div style={styles.modalButtons}>
                <button type="button" onClick={() => setShowCreateForm(false)} style={styles.cancelButton}>
                  Cancel
                </button>
                <button type="submit" style={styles.submitButton}>
                  Create Job
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Applications Modal */}
      {selectedJobApplications && (
        <div style={styles.modal} onClick={() => setSelectedJobApplications(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2>Applications</h2>
            {selectedJobApplications.applications.length === 0 ? (
              <p>No applications yet</p>
            ) : (
              <div style={styles.applicationsList}>
                {selectedJobApplications.applications.map((app) => (
                  <div key={app.id} style={styles.applicationCard}>
                    <h4>{app.applicant_name}</h4>
                    <p style={styles.email}>{app.applicant_email}</p>
                    {app.applicant_phone && (
                      <p style={styles.email}>Phone: {app.applicant_phone}</p>
                    )}
                    {app.cover_letter && (
                      <p style={styles.coverLetter}>{app.cover_letter}</p>
                    )}
                    <p style={styles.status}>Status: <strong>{app.status}</strong></p>
                    <div style={styles.appActions}>
                      <button
                        onClick={() => downloadResume(app.id, app.applicant_name)}
                        style={styles.resumeButton}
                      >
                        Download Resume
                      </button>
                      <select
                        value={app.status}
                        onChange={(e) => updateApplicationStatus(app.id, e.target.value)}
                        style={styles.statusSelect}
                      >
                        <option value="pending">Pending</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="accepted">Accepted</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setSelectedJobApplications(null)} style={styles.closeButton}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: '1200px', margin: '0 auto', padding: '20px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' },
  createButton: { padding: '10px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  jobsList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' },
  jobCard: { backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  location: { color: '#666', fontSize: '14px', margin: '10px 0' },
  applications: { color: '#007bff', fontSize: '14px', fontWeight: 'bold' },
  jobActions: { display: 'flex', gap: '10px', marginTop: '15px' },
  viewButton: { flex: 1, padding: '8px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  deleteButton: { flex: 1, padding: '8px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  noJobs: { textAlign: 'center', color: '#999', padding: '40px' },
  modal: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: 'white', padding: '30px', borderRadius: '8px', width: '90%', maxWidth: '600px', maxHeight: '90vh', overflow: 'auto' },
  form: { display: 'flex', flexDirection: 'column', gap: '15px' },
  input: { padding: '10px', border: '1px solid #ddd', borderRadius: '4px' },
  textarea: { padding: '10px', border: '1px solid #ddd', borderRadius: '4px', fontFamily: 'inherit' },
  modalButtons: { display: 'flex', gap: '10px', justifyContent: 'flex-end' },
  cancelButton: { padding: '10px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  submitButton: { padding: '10px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  error: { backgroundColor: '#f8d7da', color: '#721c24', padding: '12px', borderRadius: '4px', marginBottom: '15px' },
  success: { backgroundColor: '#d4edda', color: '#155724', padding: '12px', borderRadius: '4px', marginBottom: '15px' },
  applicationsList: { display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '20px' },
  applicationCard: { padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '6px' },
  email: { fontSize: '14px', color: '#666', margin: '5px 0' },
  coverLetter: { fontSize: '13px', fontStyle: 'italic', color: '#555', margin: '10px 0', padding: '10px', backgroundColor: 'white', borderRadius: '4px' },
  status: { fontSize: '14px', margin: '10px 0' },
  appActions: { display: 'flex', gap: '10px', marginTop: '10px' },
  resumeButton: { padding: '8px 12px', backgroundColor: '#17a2b8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  statusSelect: { padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '12px' },
  closeButton: { padding: '10px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', width: '100%' },
};
