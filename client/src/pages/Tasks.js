import { useCallback, useEffect, useState } from 'react';
import { getProjects, getTasks, updateTask } from '../api';
import { useAuth } from '../contexts/AuthContext';

const STATUSES = ['todo', 'in_progress', 'completed'];
const PRIORITIES = ['low', 'medium', 'high'];

export default function Tasks() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [tasks, setTasks] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [sort, setSort] = useState('created_at');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    getProjects({ limit: 100 }).then(({ data }) => {
      const list = data.projects || [];
      setProjects(list);
      if (list.length) setSelectedProject(list[0].id);
    }).catch(err => setError(err.response?.data?.error || 'Could not load projects.'));
  }, []);

  const fetchTasks = useCallback(async () => {
    if (!selectedProject) { setTasks([]); setTotal(0); return; }
    try {
      const { data } = await getTasks(selectedProject, { status: filterStatus || undefined, priority: filterPriority || undefined, search, sort, page, limit: 25 });
      setTasks(data.tasks || []);
      setTotal(data.pagination?.total || 0);
      setError('');
    } catch (err) { setError(err.response?.data?.error || 'Could not load tasks.'); }
  }, [selectedProject, filterStatus, filterPriority, search, sort, page]);

  useEffect(() => { setPage(1); }, [selectedProject, filterStatus, filterPriority, search, sort]);
  useEffect(() => { const timer = setTimeout(fetchTasks, 180); return () => clearTimeout(timer); }, [fetchTasks]);

  const handleStatus = async (taskId, status) => {
    try { await updateTask(taskId, { status }); await fetchTasks(); }
    catch (err) { setError(err.response?.data?.error || 'Could not update task status.'); }
  };

  return <div>
    <h2>Tasks</h2>
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="setup toolbar">
      <select value={selectedProject} onChange={event => setSelectedProject(event.target.value)} aria-label="Project">
        {projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
      </select>
      <select value={filterStatus} onChange={event => setFilterStatus(event.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{STATUSES.map(status => <option key={status}>{status}</option>)}</select>
      <select value={filterPriority} onChange={event => setFilterPriority(event.target.value)} aria-label="Filter by priority"><option value="">All priorities</option>{PRIORITIES.map(priority => <option key={priority}>{priority}</option>)}</select>
      <select value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort tasks"><option value="created_at">Newest</option><option value="due_date">Due date</option><option value="priority">Priority</option><option value="title">Title</option></select>
      <input placeholder="Search tasks..." value={search} onChange={event => setSearch(event.target.value)} aria-label="Search tasks" />
      <span>{total} task{total === 1 ? '' : 's'}</span>
    </div>
    {!projects.length && <p className="empty-state">You are not a member of any projects yet.</p>}
    {projects.length > 0 && !tasks.length && <p className="empty-state">No tasks match these filters.</p>}
    <div className="cards">{tasks.map(task => <article key={task.id} className="card">
      <h3>{task.title}</h3><p>{task.description || 'No description'}</p><p className="muted">{task.priority} priority · Due {task.due_date || 'not set'} · {task.assignee_name || 'Unassigned'}</p>
      <select value={task.status} disabled={user?.role === 'member' && task.assignee_id !== user?.id} onChange={event => handleStatus(task.id,event.target.value)} aria-label={`Status for ${task.title}`}>{STATUSES.map(status => <option key={status} value={status}>{status.replace('_',' ')}</option>)}</select>
    </article>)}</div>
    {total > 25 && <div className="toolbar pagination"><button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.ceil(total / 25)}</span><button className="secondary" disabled={page >= Math.ceil(total / 25)} onClick={() => setPage(page + 1)}>Next</button></div>}
  </div>;
}
