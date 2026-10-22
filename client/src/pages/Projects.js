import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { changeProjectManager, createProject, deleteProject, getProjects, getUsers, updateProject } from '../api';
import { useAuth } from '../contexts/AuthContext';

export default function Projects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState({ title: '', description: '', deadline: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [managers, setManagers] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', deadline: '' });
  const canManage = user?.role === 'admin' || user?.role === 'manager';

  const fetchProjects = useCallback(async () => {
    try {
      const { data } = await getProjects({ search: query, status: status || undefined, page, limit: 25 });
      setProjects(data.projects || []);
      setTotal(data.pagination?.total || 0);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load projects.');
    }
  }, [query, status, page]);

  useEffect(() => { setPage(1); }, [query, status]);
  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  useEffect(() => {
    if (user?.role === 'admin') getUsers({ limit: 100 }).then(({ data }) => setManagers((data.users || []).filter(item => ['admin', 'manager'].includes(item.role)))).catch(() => {});
  }, [user]);

  const handleCreate = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createProject(form);
      setForm({ title: '', description: '', deadline: '' });
      await fetchProjects();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create project.');
    } finally { setBusy(false); }
  };

  const changeStatus = async (project, nextStatus) => {
    try { await updateProject(project.id, { status: nextStatus }); await fetchProjects(); }
    catch (err) { setError(err.response?.data?.error || 'Could not update project.'); }
  };

  const removeProject = async (project) => {
    if (!window.confirm(`Delete “${project.title}” and its tasks?`)) return;
    try { await deleteProject(project.id); await fetchProjects(); }
    catch (err) { setError(err.response?.data?.error || 'Could not delete project.'); }
  };

  const assignManager = async (project, managerId) => {
    try { await changeProjectManager(project.id, managerId); await fetchProjects(); }
    catch (err) { setError(err.response?.data?.error || 'Could not assign the project manager.'); }
  };

  const startEdit = project => {
    setEditingId(project.id);
    setEditForm({ title: project.title, description: project.description || '', deadline: project.deadline ? String(project.deadline).slice(0,10) : '' });
  };
  const saveEdit = async event => {
    event.preventDefault();
    try { await updateProject(editingId, { ...editForm, deadline: editForm.deadline || null }); setEditingId(null); await fetchProjects(); }
    catch (err) { setError(err.response?.data?.error || 'Could not update project.'); }
  };

  return <div>
    <h2>Projects</h2>
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="setup toolbar">
      <input aria-label="Search projects" placeholder="Search projects..." value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="Filter projects by status" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">All statuses</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option><option value="archived">Archived</option>
      </select>
    </div>
    {canManage && <form onSubmit={handleCreate} className="setup project-form">
      <h3>Create project</h3>
      <label>Title<input value={form.title} maxLength={255} onChange={event => setForm({ ...form, title: event.target.value })} required /></label>
      <label>Description<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
      <label>Deadline<input type="date" value={form.deadline} onChange={event => setForm({ ...form, deadline: event.target.value })} /></label>
      <button disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button>
    </form>}
    {projects.length === 0 ? <p className="empty-state">No projects match your filters.</p> : <div className="cards">
      {projects.map(project => <article key={project.id} className="card">
        {editingId === project.id ? <form onSubmit={saveEdit}>
          <label>Title<input required maxLength={255} value={editForm.title} onChange={event => setEditForm({ ...editForm, title: event.target.value })} /></label>
          <label>Description<input value={editForm.description} onChange={event => setEditForm({ ...editForm, description: event.target.value })} /></label>
          <label>Deadline<input type="date" value={editForm.deadline} onChange={event => setEditForm({ ...editForm, deadline: event.target.value })} /></label>
          <div className="toolbar"><button>Save changes</button><button type="button" className="secondary" onClick={() => setEditingId(null)}>Cancel</button></div>
        </form> : <>
        <h3><Link to={`/projects/${project.id}`}>{project.title}</Link></h3>
        <p>{project.description || 'No description'}</p>
        <p className="muted">Manager: {project.manager_name || '—'} · Deadline: {project.deadline || 'Not set'}</p>
        {user?.role === 'admin' && <label>Project manager<select value={project.manager_id} onChange={event => assignManager(project,event.target.value)}>{managers.map(manager => <option key={manager.id} value={manager.id}>{manager.name} ({manager.role})</option>)}</select></label>}
        <label>Status<select value={project.status} disabled={!project.can_manage} onChange={event => changeStatus(project, event.target.value)}>
          <option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option><option value="archived">Archived</option>
        </select></label>
        {project.can_manage && <div className="toolbar"><button className="secondary" onClick={() => startEdit(project)}>Edit details</button><button className="danger" onClick={() => removeProject(project)}>Delete project</button></div>}
        </>}
      </article>)}
    </div>}
    {total > 25 && <div className="toolbar pagination"><button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.ceil(total / 25)}</span><button className="secondary" disabled={page >= Math.ceil(total / 25)} onClick={() => setPage(page + 1)}>Next</button></div>}
  </div>;
}
