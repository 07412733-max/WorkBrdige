import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Axios client for WorkBridge API
 * 
 * Security features:
 * - Access token stored in memory (not localStorage)
 * - CSRF token stored in memory and synced with cookie
 * - Automatic token refresh on 401 errors
 * - withCredentials for httpOnly refresh token cookies
 */

// In-memory token storage (never localStorage for security)
let accessToken = null;
let csrfToken = null;
let csrfRequest = null;
let sessionRefreshRequest = null;

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Get CSRF token from cookie
 * @returns {string|null} CSRF token from wb_csrf cookie
 */
const getCsrfTokenFromCookie = () => {
  const cookies = document.cookie.split(';');
  for (let cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'wb_csrf') {
      return value;
    }
  }
  return null;
};

const ensureCsrfToken = async () => {
  csrfToken = getCsrfTokenFromCookie() || csrfToken;
  if (csrfToken) return csrfToken;

  if (!csrfRequest) {
    csrfRequest = axios
      .get(`${API_URL}/api/auth/csrf-token`, { withCredentials: true })
      .then(({ data }) => {
        csrfToken = data.csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfRequest = null;
      });
  }
  return csrfRequest;
};

/**
 * Create axios instance
 */
const client = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Include cookies (refresh token)
});

/**
 * Set access token in memory
 */
export const setAccessToken = (token) => {
  accessToken = token;
};

/**
 * Get access token from memory
 */
export const getAccessToken = () => {
  return accessToken;
};

/**
 * Clear access token from memory
 */
export const clearAccessToken = () => {
  accessToken = null;
};

/**
 * Set CSRF token in memory
 */
export const setCsrfToken = (token) => {
  csrfToken = token;
};

/**
 * Get CSRF token from memory (fallback to cookie)
 */
export const getCsrfToken = () => {
  return csrfToken || getCsrfTokenFromCookie();
};

/**
 * Clear CSRF token from memory
 */
export const clearCsrfToken = () => {
  csrfToken = null;
};

/**
 * Fetch and set CSRF token from server
 */
export const fetchCsrfToken = () => ensureCsrfToken();

/**
 * Request interceptor - Attach access token to requests
 */
client.interceptors.request.use(
  async (config) => {
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    if (mutatingMethods.has((config.method || 'get').toUpperCase())) {
      config.headers['X-CSRF-Token'] = await ensureCsrfToken();
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor - Handle 401 errors with automatic token refresh
 */
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

client.interceptors.response.use(
  (response) => {
    if (response.data?.csrfToken) {
      csrfToken = response.data.csrfToken;
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // If error is not 401 or request already retried, reject
    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      /\/api\/auth\/(login|register|refresh)$/.test(originalRequest.url || '')
    ) {
      return Promise.reject(error);
    }

    // If already refreshing, queue the request
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return client(originalRequest);
        })
        .catch((err) => {
          return Promise.reject(err);
        });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      // Attempt to refresh the token
      const currentCsrfToken = await ensureCsrfToken();
      const { data } = await axios.post(
        `${API_URL}/api/auth/refresh`,
        {},
        {
          withCredentials: true,
          headers: { 'X-CSRF-Token': currentCsrfToken },
        }
      );

      const newAccessToken = data.accessToken;
      setAccessToken(newAccessToken);
      if (data.csrfToken) csrfToken = data.csrfToken;

      // Process queued requests
      processQueue(null, newAccessToken);

      // Retry original request with new token
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return client(originalRequest);
    } catch (refreshError) {
      // Refresh failed, clear token and redirect to login
      processQueue(refreshError, null);
      clearAccessToken();
      clearCsrfToken();

      // Dispatch custom event for app to handle (e.g., redirect to login)
      window.dispatchEvent(new CustomEvent('auth:logout'));

      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

/**
 * API helper functions
 */

// Authentication
export const auth = {
  register: (data) => client.post('/api/auth/register', data),
  login: (data) => client.post('/api/auth/login', data),
  logout: () => client.post('/api/auth/logout'),
  getProfile: () => client.get('/api/auth/me'),
  refresh: () => {
    if (!sessionRefreshRequest) {
      sessionRefreshRequest = client
        .post('/api/auth/refresh')
        .finally(() => {
          sessionRefreshRequest = null;
        });
    }
    return sessionRefreshRequest;
  },
};

// Jobs (Public)
export const jobs = {
  getAll: (params) => client.get('/api/jobs', { params }),
  getById: (jobId) => client.get(`/api/jobs/${jobId}`),
};

// Job Seeker
export const jobSeeker = {
  apply: (jobId, formData) =>
    client.post(`/api/jobs/${jobId}/apply`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getApplications: () => client.get('/api/jobs/seeker/applications'),
};

// Employer
export const employer = {
  createJob: (data) => client.post('/api/jobs/employer/listings', data),
  getJobs: () => client.get('/api/jobs/employer/listings'),
  updateJob: (jobId, data) =>
    client.patch(`/api/jobs/employer/listings/${jobId}`, data),
  deleteJob: (jobId) => client.delete(`/api/jobs/employer/listings/${jobId}`),
  getApplications: (jobId) =>
    client.get(`/api/jobs/employer/listings/${jobId}/applications`),
  updateApplicationStatus: (applicationId, status) =>
    client.patch(`/api/jobs/employer/applications/${applicationId}/status`, {
      status,
    }),
  downloadResume: (applicationId) =>
    client.get(`/api/jobs/employer/applications/${applicationId}/resume`, {
      responseType: 'blob',
    }),
};

// Admin
export const admin = {
  getUsers: (params) => client.get('/api/admin/users', { params }),
  getUserDetails: (userId) => client.get(`/api/admin/users/${userId}`),
  suspendUser: (userId, is_suspended) =>
    client.patch(`/api/admin/users/${userId}/suspend`, { is_suspended }),
  deleteUser: (userId) => client.delete(`/api/admin/users/${userId}`),
  getJobs: (params) => client.get('/api/admin/jobs', { params }),
  deleteJob: (jobId) => client.delete(`/api/admin/jobs/${jobId}`),
  getStats: () => client.get('/api/admin/stats'),
  getActivity: (params) => client.get('/api/admin/activity', { params }),
  getAuditLogs: (params) => client.get('/api/admin/audit-logs', { params }),
};

export default client;
