import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' }
});

// Keep the bearer token for this browser tab only.
api.interceptors.request.use(config => {
  const token = sessionStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const register = (data) => api.post('/auth/register', data);
export const login = (data) => api.post('/auth/login', data);
export const getMe = () => api.get('/auth/me');
export const requestPasswordReset = (email) => api.post('/auth/forgot-password', { email });
export const resetPassword = (token, password) => api.post('/auth/reset-password', { token, password });
export const getUsers = (params) => api.get('/users', { params });
export const updateUserRole = (id, role) => api.patch(`/users/${id}/role`, { role });
export const deleteUser = (id) => api.delete(`/users/${id}`);
export const getAuditLogs = (params) => api.get('/audit-logs', { params });
export const getProjects = (params) => api.get('/projects', { params });
export const createProject = (data) => api.post('/projects', data);
export const getProject = (id) => api.get(`/projects/${id}`);
export const updateProject = (id, data) => api.put(`/projects/${id}`, data);
export const changeProjectManager = (id, manager_id) => api.patch(`/projects/${id}/manager`, { manager_id });
export const deleteProject = (id) => api.delete(`/projects/${id}`);
export const getProjectMembers = (id) => api.get(`/projects/${id}/members`);
export const addProjectMember = (id, data) => api.post(`/projects/${id}/members`, data);
export const removeProjectMember = (id, userId) => api.delete(`/projects/${id}/members/${userId}`);
export const inviteProjectMember = (id, email) => api.post(`/projects/${id}/invitations`, { email });
export const acceptProjectInvite = (token) => api.post('/projects/invitations/accept', { token });
export const getTasks = (projectId, params) => api.get(`/projects/${projectId}/tasks`, { params });
export const createTask = (data) => api.post('/tasks', data);
export const updateTask = (id, data) => api.put(`/tasks/${id}`, data);
export const deleteTask = (id) => api.delete(`/tasks/${id}`);
export const getTaskHistory = (taskId) => api.get(`/tasks/${taskId}/history`);
export const getComments = (taskId) => api.get(`/tasks/${taskId}/comments`);
export const addComment = (taskId, data) => api.post(`/tasks/${taskId}/comments`, data);
export const getAttachments = (taskId) => api.get(`/tasks/${taskId}/attachments`);
export const uploadAttachment = (taskId, data) => api.post(`/tasks/${taskId}/attachments`, data);
export const deleteAttachment = (id) => api.delete(`/attachments/${id}`);
export const downloadAttachment = (id) => api.get(`/attachments/${id}/download`, { responseType: 'blob' });
export const getDashboardProgress = () => api.get('/dashboard/progress');
export const getDashboardUpcoming = () => api.get('/dashboard/upcoming');
export const getDashboardStats = () => api.get('/dashboard/statistics');

export default api;
