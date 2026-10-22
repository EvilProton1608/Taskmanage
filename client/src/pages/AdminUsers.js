import { useCallback, useEffect, useState } from 'react';
import { deleteUser, getAuditLogs, getUsers, updateUserRole } from '../api';
import { useAuth } from '../contexts/AuthContext';

const roles = ['member', 'manager', 'admin'];

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [userResult, logResult] = await Promise.all([getUsers({ limit: 100 }), getAuditLogs({ limit: 100 })]);
      setUsers(userResult.data.users || []);
      setLogs(logResult.data.audit_logs || []);
    } catch (err) { setError(err.response?.data?.error || 'Could not load administration data.'); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const setRole = async (user, role) => {
    setError(''); setNotice('');
    try { await updateUserRole(user.id, role); setNotice(`${user.name}'s role was updated.`); await refresh(); }
    catch (err) { setError(err.response?.data?.error || 'Role update failed.'); }
  };
  const remove = async user => {
    if (!window.confirm(`Permanently delete ${user.name}'s account?`)) return;
    try { await deleteUser(user.id); await refresh(); }
    catch (err) { setError(err.response?.data?.error || 'User deletion failed.'); }
  };

  return <div><h2>Administration</h2>
    {error && <p role="alert" className="error-message">{error}</p>}{notice && <p role="status" className="success-message">{notice}</p>}
    <section className="setup"><h3>Users and roles</h3><div className="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead><tbody>
      {users.map(user => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td><select aria-label={`Role for ${user.name}`} value={user.role} onChange={event => setRole(user,event.target.value)}>{roles.map(role => <option key={role}>{role}</option>)}</select></td><td>{new Date(user.created_at).toLocaleDateString()}</td><td>{user.id !== currentUser?.id && <button className="danger" onClick={() => remove(user)}>Delete</button>}</td></tr>)}
    </tbody></table></div></section>
    <section className="setup"><h3>Recent audit activity</h3><div className="table-scroll"><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th></tr></thead><tbody>
      {logs.map(log => <tr key={log.id}><td>{new Date(log.created_at).toLocaleString()}</td><td>{log.user_name || 'Deleted account'}</td><td>{log.action}</td><td>{log.entity_type || '—'} {log.entity_id || ''}</td></tr>)}
    </tbody></table></div></section>
  </div>;
}
