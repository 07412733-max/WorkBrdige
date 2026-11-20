import DOMPurify from 'dompurify';

/**
 * SafeJobCard Component
 * Displays job listing with XSS-safe description rendering
 * 
 * Security:
 * - React auto-escapes title, location, salary (plain text)
 * - DOMPurify.sanitize() for HTML description before rendering
 */
export default function SafeJobCard({ job, onApply, showActions = true }) {
  // Sanitize HTML description (in case employer includes formatting)
  const sanitizedDescription = DOMPurify.sanitize(job.description, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: [],
  });

  return (
    <div style={styles.card}>
      <h3 style={styles.title}>{job.title}</h3>
      <div style={styles.meta}>
        <span>📍 {job.location}</span>
        {job.salary_range && <span>💰 {job.salary_range}</span>}
        {job.employer_name && <span>🏢 {job.employer_name}</span>}
      </div>

      {/* Sanitized HTML description */}
      <div
        style={styles.description}
        dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
      />

      <div style={styles.footer}>
        <small style={styles.date}>
          Posted: {new Date(job.created_at).toLocaleDateString()}
        </small>
        {showActions && job.status === 'open' && onApply && (
          <button onClick={() => onApply(job.id)} style={styles.applyButton}>
            Apply Now
          </button>
        )}
        {job.status === 'closed' && (
          <span style={styles.closedBadge}>Closed</span>
        )}
      </div>
    </div>
  );
}

const styles = {
  card: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    marginBottom: '15px',
  },
  title: {
    margin: '0 0 10px 0',
    color: '#333',
    fontSize: '20px',
  },
  meta: {
    display: 'flex',
    gap: '15px',
    fontSize: '14px',
    color: '#666',
    marginBottom: '15px',
    flexWrap: 'wrap',
  },
  description: {
    color: '#555',
    lineHeight: '1.6',
    marginBottom: '15px',
    fontSize: '14px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '15px',
    borderTop: '1px solid #eee',
  },
  date: {
    color: '#999',
  },
  applyButton: {
    padding: '8px 16px',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  closedBadge: {
    padding: '4px 12px',
    backgroundColor: '#6c757d',
    color: 'white',
    borderRadius: '4px',
    fontSize: '12px',
  },
};
