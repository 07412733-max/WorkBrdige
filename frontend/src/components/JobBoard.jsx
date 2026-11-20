import { useState, useEffect } from 'react';
import { jobs as jobsApi, jobSeeker } from '../api/client';
import SafeJobCard from './SafeJobCard';

/**
 * JobBoard Component
 * Public job search and application interface
 * 
 * Security:
 * - Uses SafeJobCard for XSS-safe rendering
 * - PDF file validation (2MB max, .pdf extension)
 */
export default function JobBoard({ user }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [coverLetter, setCoverLetter] = useState('');
  const [applicantPhone, setApplicantPhone] = useState('');
  const [resumeFile, setResumeFile] = useState(null);
  const [applyError, setApplyError] = useState('');
  const [applySuccess, setApplySuccess] = useState('');
  const [myApplications, setMyApplications] = useState([]);
  const [showApplications, setShowApplications] = useState(false);
  const [loadingApplications, setLoadingApplications] = useState(false);

  useEffect(() => {
    fetchJobs();
    if (user?.role === 'job_seeker') {
      fetchMyApplications();
    }
  }, [user]);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const params = {};
      if (search) params.search = search;
      if (location) params.location = location;

      const { data } = await jobsApi.getAll(params);
      setJobs(data.jobs);
    } catch (err) {
      setError('Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  const fetchMyApplications = async () => {
    try {
      setLoadingApplications(true);
      const { data } = await jobSeeker.getApplications();
      setMyApplications(data.applications);
    } catch (err) {
      console.error('Failed to load applications:', err);
    } finally {
      setLoadingApplications(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    fetchJobs();
  };

  const handleApply = (jobId) => {
    if (!user || user.role !== 'job_seeker') {
      alert('Please login as a job seeker to apply');
      return;
    }
    setSelectedJobId(jobId);
    setShowApplyModal(true);
    setApplyError('');
    setApplySuccess('');
  };

  const handleSubmitApplication = async (e) => {
    e.preventDefault();
    setApplyError('');

    if (!resumeFile) {
      setApplyError('Please upload your resume (PDF format)');
      return;
    }

    // Client-side validation
    if (!resumeFile.name.toLowerCase().endsWith('.pdf')) {
      setApplyError('Resume must be a PDF file');
      return;
    }

    if (resumeFile.size > 2 * 1024 * 1024) {
      setApplyError('Resume must be less than 2 MB');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('resume', resumeFile);
      if (coverLetter.trim()) {
        formData.append('cover_letter', coverLetter);
      }
      if (applicantPhone.trim()) {
        formData.append('applicant_phone', applicantPhone);
      }

      await jobSeeker.apply(selectedJobId, formData);
      setApplySuccess('Application submitted successfully!');
      fetchMyApplications(); // Refresh applications list
      setTimeout(() => {
        setShowApplyModal(false);
        setCoverLetter('');
        setApplicantPhone('');
        setResumeFile(null);
        setApplySuccess('');
      }, 2000);
    } catch (err) {
      setApplyError(err.response?.data?.error || 'Failed to submit application');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Job Board</h1>
        {user?.role === 'job_seeker' && (
          <button
            onClick={() => setShowApplications(!showApplications)}
            style={styles.myAppsButton}
          >
            {showApplications ? 'View Jobs' : `My Applications (${myApplications.length})`}
          </button>
        )}
      </div>

      {/* My Applications Section */}
      {showApplications && user?.role === 'job_seeker' && (
        <div style={styles.applicationsSection}>
          <h2 style={styles.sectionTitle}>My Applications</h2>
          {loadingApplications ? (
            <p>Loading applications...</p>
          ) : myApplications.length === 0 ? (
            <p style={styles.noApps}>You haven't applied to any jobs yet.</p>
          ) : (
            <div style={styles.applicationsList}>
              {myApplications.map((app) => (
                <div key={app.id} style={styles.applicationCard}>
                  <div style={styles.appHeader}>
                    <h3 style={styles.appJobTitle}>{app.job_title}</h3>
                    <span style={getStatusStyle(app.status)}>
                      {app.status.toUpperCase()}
                    </span>
                  </div>
                  
                  <div style={styles.appDetails}>
                    <p style={styles.appInfo}>
                      <strong>📍 Location:</strong> {app.job_location}
                    </p>
                    <p style={styles.appInfo}>
                      <strong>🏢 Company:</strong> {app.employer_name}
                    </p>
                    {app.job_salary && (
                      <p style={styles.appInfo}>
                        <strong>💰 Salary:</strong> {app.job_salary}
                      </p>
                    )}
                    <p style={styles.appInfo}>
                      <strong>📋 Job Status:</strong> {app.job_status === 'open' ? '✅ Open' : '❌ Closed'}
                    </p>
                  </div>

                  {app.job_description && (
                    <div style={styles.jobDescriptionBox}>
                      <strong style={styles.descLabel}>Job Description:</strong>
                      <p style={styles.jobDescText}>
                        {app.job_description.length > 200 
                          ? `${app.job_description.substring(0, 200)}...` 
                          : app.job_description}
                      </p>
                    </div>
                  )}

                  {app.cover_letter && (
                    <div style={styles.coverLetterBox}>
                      <strong style={styles.descLabel}>Your Cover Letter:</strong>
                      <p style={styles.coverLetterText}>{app.cover_letter}</p>
                    </div>
                  )}

                  <div style={styles.appFooter}>
                    <div style={styles.appDates}>
                      <span style={styles.appDate}>
                        📅 Applied: {new Date(app.created_at).toLocaleDateString()}
                      </span>
                      {app.updated_at !== app.created_at && (
                        <span style={styles.appDate}>
                          🔄 Updated: {new Date(app.updated_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!showApplications && (
        <>
          {/* Search Form */}
          <form onSubmit={handleSearch} style={styles.searchForm}>
        <input
          type="text"
          placeholder="Search jobs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.searchInput}
        />
        <input
          type="text"
          placeholder="Location..."
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          style={styles.searchInput}
        />
        <button type="submit" style={styles.searchButton}>
          Search
        </button>
      </form>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <p>Loading jobs...</p>
      ) : jobs.length === 0 ? (
        <p style={styles.noJobs}>No jobs found</p>
      ) : (
        <div style={styles.jobsList}>
          {jobs.map((job) => (
            <SafeJobCard
              key={job.id}
              job={job}
              onApply={handleApply}
              showActions={user?.role === 'job_seeker'}
            />
          ))}
        </div>
      )}
        </>
      )}

      {/* Application Modal */}
      {showApplyModal && (
        <div style={styles.modal} onClick={() => setShowApplyModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3>Apply for Job</h3>

            {applySuccess && <div style={styles.success}>{applySuccess}</div>}
            {applyError && <div style={styles.error}>{applyError}</div>}

            <form onSubmit={handleSubmitApplication} style={styles.form}>
              <label style={styles.label}>
                Resume (PDF, max 2 MB) *
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setResumeFile(e.target.files[0])}
                  required
                  style={styles.fileInput}
                />
              </label>

              <label style={styles.label}>
                Phone (optional)
                <input
                  type="tel"
                  value={applicantPhone}
                  onChange={(e) => setApplicantPhone(e.target.value)}
                  maxLength={32}
                  style={styles.searchInput}
                />
              </label>

              <label style={styles.label}>
                Cover Letter (optional)
                <textarea
                  value={coverLetter}
                  onChange={(e) => setCoverLetter(e.target.value)}
                  rows={5}
                  maxLength={2000}
                  style={styles.textarea}
                  placeholder="Tell us why you're a great fit..."
                />
              </label>

              <div style={styles.modalButtons}>
                <button type="button" onClick={() => setShowApplyModal(false)} style={styles.cancelButton}>
                  Cancel
                </button>
                <button type="submit" style={styles.submitButton}>
                  Submit Application
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const getStatusStyle = (status) => {
  const baseStyle = {
    padding: '4px 12px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 'bold',
  };

  switch (status) {
    case 'pending':
      return { ...baseStyle, backgroundColor: '#ffc107', color: '#000' };
    case 'reviewed':
      return { ...baseStyle, backgroundColor: '#17a2b8', color: '#fff' };
    case 'accepted':
      return { ...baseStyle, backgroundColor: '#28a745', color: '#fff' };
    case 'rejected':
      return { ...baseStyle, backgroundColor: '#dc3545', color: '#fff' };
    default:
      return { ...baseStyle, backgroundColor: '#6c757d', color: '#fff' };
  }
};

const styles = {
  container: {
    maxWidth: '1000px',
    margin: '0 auto',
    padding: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px',
  },
  title: {
    margin: 0,
    color: '#333',
  },
  myAppsButton: {
    padding: '10px 20px',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  applicationsSection: {
    marginBottom: '40px',
  },
  sectionTitle: {
    marginBottom: '20px',
    color: '#333',
  },
  applicationsList: {
    display: 'grid',
    gap: '20px',
  },
  applicationCard: {
    backgroundColor: 'white',
    padding: '25px',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    border: '1px solid #e0e0e0',
  },
  appHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '15px',
    paddingBottom: '15px',
    borderBottom: '2px solid #f0f0f0',
  },
  appJobTitle: {
    margin: '0',
    color: '#333',
    fontSize: '20px',
    fontWeight: 'bold',
    flex: 1,
    marginRight: '15px',
  },
  appDetails: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '10px',
    marginBottom: '15px',
  },
  appInfo: {
    fontSize: '14px',
    color: '#555',
    margin: '5px 0',
  },
  jobDescriptionBox: {
    backgroundColor: '#f8f9fa',
    padding: '15px',
    borderRadius: '6px',
    marginBottom: '15px',
    border: '1px solid #e9ecef',
  },
  descLabel: {
    fontSize: '13px',
    color: '#333',
    display: 'block',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  jobDescText: {
    fontSize: '14px',
    color: '#555',
    margin: '0',
    lineHeight: '1.5',
  },
  coverLetterBox: {
    backgroundColor: '#e3f2fd',
    padding: '15px',
    borderRadius: '6px',
    marginBottom: '15px',
    border: '1px solid #bbdefb',
  },
  coverLetterText: {
    fontSize: '14px',
    color: '#555',
    margin: '0',
    lineHeight: '1.5',
    fontStyle: 'italic',
  },
  appFooter: {
    paddingTop: '15px',
    borderTop: '1px solid #f0f0f0',
  },
  appDates: {
    display: 'flex',
    gap: '20px',
    flexWrap: 'wrap',
  },
  appDate: {
    fontSize: '13px',
    color: '#888',
  },
  appLocation: {
    fontSize: '14px',
    color: '#666',
    margin: '5px 0',
  },
  appEmployer: {
    fontSize: '14px',
    color: '#666',
    margin: '5px 0',
  },
  noApps: {
    textAlign: 'center',
    color: '#999',
    padding: '40px',
    backgroundColor: 'white',
    borderRadius: '8px',
  },
  searchForm: {
    display: 'flex',
    gap: '10px',
    marginBottom: '30px',
    flexWrap: 'wrap',
  },
  searchInput: {
    flex: 1,
    minWidth: '200px',
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
  },
  searchButton: {
    padding: '10px 20px',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  jobsList: {
    marginTop: '20px',
  },
  noJobs: {
    textAlign: 'center',
    color: '#999',
    padding: '40px',
  },
  error: {
    backgroundColor: '#f8d7da',
    color: '#721c24',
    padding: '12px',
    borderRadius: '4px',
    marginBottom: '15px',
  },
  success: {
    backgroundColor: '#d4edda',
    color: '#155724',
    padding: '12px',
    borderRadius: '4px',
    marginBottom: '15px',
  },
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: 'white',
    padding: '30px',
    borderRadius: '8px',
    width: '90%',
    maxWidth: '500px',
    maxHeight: '90vh',
    overflow: 'auto',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  fileInput: {
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
  },
  textarea: {
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontFamily: 'inherit',
    fontSize: '14px',
  },
  modalButtons: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    marginTop: '10px',
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  submitButton: {
    padding: '10px 20px',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
};
