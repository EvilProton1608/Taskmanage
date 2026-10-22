import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { addComment, addProjectMember, createTask, deleteAttachment, deleteTask, downloadAttachment, getAttachments, getComments, getProject, getProjectMembers, getTaskHistory, getTasks, inviteProjectMember, removeProjectMember, updateTask, uploadAttachment } from '../api';
import { useAuth } from '../contexts/AuthContext';

const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES = ['todo', 'in_progress', 'completed'];

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', status: 'todo', due_date: '', assignee_id: '' });
  const [editingTask, setEditingTask] = useState(null);
  const [taskEdit, setTaskEdit] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [history, setHistory] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const reportError = useCallback(err => { setError(err.response?.data?.error || 'The request could not be completed.'); setNotice(''); }, []);
  const fetchTasks = useCallback(async () => { const { data } = await getTasks(id); setTasks(data.tasks || []); }, [id]);
  const fetchMembers = useCallback(async () => { const { data } = await getProjectMembers(id); setMembers(data.members || []); }, [id]);

  useEffect(() => {
    Promise.all([getProject(id), fetchTasks(), fetchMembers()])
      .then(([{ data }]) => setProject(data.project))
      .catch(reportError);
  }, [id, fetchTasks, fetchMembers, reportError]);

  useEffect(() => {
    if (!selectedTask) return undefined;
    const refreshDiscussion = async () => {
      try {
        const [commentResult, attachmentResult, historyResult] = await Promise.all([getComments(selectedTask), getAttachments(selectedTask), getTaskHistory(selectedTask)]);
        setComments(commentResult.data.comments || []);
        setAttachments(attachmentResult.data.attachments || []);
        setHistory(historyResult.data.history || []);
      } catch (_) { /* Keep the current panel visible during a brief network interruption. */ }
    };
    const timer = setInterval(refreshDiscussion, 5000);
    return () => clearInterval(timer);
  }, [selectedTask]);

  const handleCreate = async event => {
    event.preventDefault();
    try {
      await createTask({ ...form, project_id: id, assignee_id: form.assignee_id || null, due_date: form.due_date || null });
      setForm({ title: '', description: '', priority: 'medium', status: 'todo', due_date: '', assignee_id: '' });
      await fetchTasks();
      setError('');
    } catch (err) { reportError(err); }
  };

  const handleStatusChange = async (taskId, status) => {
    try { await updateTask(taskId, { status }); await fetchTasks(); setError(''); }
    catch (err) { reportError(err); await fetchTasks(); }
  };

  const handleDelete = async taskId => {
    try { await deleteTask(taskId); if (selectedTask === taskId) setSelectedTask(null); await fetchTasks(); }
    catch (err) { reportError(err); }
  };

  const beginTaskEdit = task => {
    setEditingTask(task.id);
    setTaskEdit({ title: task.title, description: task.description || '', priority: task.priority, due_date: task.due_date ? String(task.due_date).slice(0,10) : '', assignee_id: task.assignee_id || '' });
  };
  const saveTaskEdit = async event => {
    event.preventDefault();
    try { await updateTask(editingTask, { ...taskEdit, due_date: taskEdit.due_date || null, assignee_id: taskEdit.assignee_id || null }); setEditingTask(null); setTaskEdit(null); await fetchTasks(); }
    catch (err) { reportError(err); }
  };

  const openTaskDetails = async taskId => {
    setSelectedTask(taskId);
    try {
      const [commentResult, attachmentResult, historyResult] = await Promise.all([getComments(taskId), getAttachments(taskId), getTaskHistory(taskId)]);
      setComments(commentResult.data.comments || []);
      setAttachments(attachmentResult.data.attachments || []);
      setHistory(historyResult.data.history || []);
      setError('');
    } catch (err) { reportError(err); }
  };

  const handleAddComment = async event => {
    event.preventDefault();
    try { await addComment(selectedTask, { content: commentText }); setCommentText(''); await openTaskDetails(selectedTask); }
    catch (err) { reportError(err); }
  };

  const handleUpload = async event => {
    event.preventDefault();
    const file = event.target.elements.file.files[0];
    if (!file || !selectedTask) return;
    if (file.size > 5 * 1024 * 1024) { setError('Files must be 5 MB or smaller.'); return; }
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await uploadAttachment(selectedTask, { file_name: file.name, mime_type: file.type, data });
      event.target.reset();
      await openTaskDetails(selectedTask);
    } catch (err) { reportError(err); }
  };

  const handleDownload = async attachment => {
    try {
      const { data } = await downloadAttachment(attachment.id);
      const url = URL.createObjectURL(data);
      const link = document.createElement('a'); link.href = url; link.download = attachment.file_name; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { reportError(err); }
  };

  const addMember = async event => {
    event.preventDefault();
    try { await addProjectMember(id, { email: memberEmail }); setMemberEmail(''); setNotice('Member added.'); await fetchMembers(); }
    catch (err) { reportError(err); }
  };

  const inviteMember = async event => {
    event.preventDefault();
    try {
      const { data } = await inviteProjectMember(id, inviteEmail);
      setInviteEmail('');
      setNotice(data.invitation_url ? `${data.message} ${data.invitation_url}` : data.message);
      setError('');
    } catch (err) { reportError(err); }
  };

  const removeMember = async member => {
    if (!window.confirm(`Remove ${member.name} from this project?`)) return;
    try { await removeProjectMember(id, member.id); await fetchMembers(); }
    catch (err) { reportError(err); }
  };

  const isProjectManager = project?.manager_id === user?.id || members.some(member => member.id === user?.id && member.project_role === 'manager');
  const canManage = user?.role === 'admin' || isProjectManager;

  return <div>
    <h2>{project?.title || 'Project tasks'}</h2>
    {project?.description && <p>{project.description}</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {notice && <p role="status" className="success-message">{notice}</p>}
    <form onSubmit={handleCreate} className="setup task-form">
      <h3>Create task</h3>
      <input aria-label="Task title" placeholder="Task title" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required maxLength={255} />
      <input aria-label="Description" placeholder="Description" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
      <div className="toolbar">
        <select aria-label="Priority" value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>{PRIORITIES.map(priority => <option key={priority}>{priority}</option>)}</select>
        <select aria-label="Initial status" value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{STATUSES.map(status => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select>
        <select aria-label="Assignee" value={form.assignee_id} onChange={event => setForm({ ...form, assignee_id: event.target.value })}>
          <option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
        <input aria-label="Due date" type="date" value={form.due_date} onChange={event => setForm({ ...form, due_date: event.target.value })} />
        <button type="submit">Add task</button>
      </div>
    </form>
    {tasks.length === 0 ? <p className="empty-state">No tasks in this project yet.</p> : <div className="cards">
      {tasks.map(task => <article key={task.id} className="card">
        {editingTask === task.id ? <form onSubmit={saveTaskEdit}>
          <label>Title<input required maxLength={255} value={taskEdit.title} onChange={event => setTaskEdit({ ...taskEdit, title: event.target.value })} /></label>
          <label>Description<input value={taskEdit.description} onChange={event => setTaskEdit({ ...taskEdit, description: event.target.value })} /></label>
          <label>Priority<select value={taskEdit.priority} onChange={event => setTaskEdit({ ...taskEdit, priority: event.target.value })}>{PRIORITIES.map(priority => <option key={priority}>{priority}</option>)}</select></label>
          <label>Due date<input type="date" value={taskEdit.due_date} onChange={event => setTaskEdit({ ...taskEdit, due_date: event.target.value })} /></label>
          <label>Assignee<select value={taskEdit.assignee_id} onChange={event => setTaskEdit({ ...taskEdit, assignee_id: event.target.value })}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <div className="toolbar"><button>Save task</button><button type="button" className="secondary" onClick={() => setEditingTask(null)}>Cancel</button></div>
        </form> : <>
        <h3>{task.title}</h3><p>{task.description || 'No description'}</p>
        <p className="muted">{task.priority} priority · Due {task.due_date || 'not set'} · Assigned to {task.assignee_name || 'nobody'}</p>
        <div className="toolbar">
          <select aria-label={`Status for ${task.title}`} value={task.status} disabled={!canManage && task.assignee_id !== user?.id} onChange={event => handleStatusChange(task.id, event.target.value)}>{STATUSES.map(status => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select>
          <button className="secondary" onClick={() => openTaskDetails(task.id)}>Comments & files</button>
          {(canManage || task.assignee_id === user?.id) && <button className="secondary" onClick={() => beginTaskEdit(task)}>Edit</button>}
          {canManage && <button className="danger" onClick={() => handleDelete(task.id)}>Delete</button>}
        </div>
        </>}
      </article>)}
    </div>}
    {canManage && <section className="setup">
      <h3>Project team</h3>
      {isProjectManager && <>
        <form onSubmit={addMember} className="toolbar"><input aria-label="Existing member email" type="email" required placeholder="Existing account email" value={memberEmail} onChange={event => setMemberEmail(event.target.value)} /><button>Add team member</button></form>
        <form onSubmit={inviteMember} className="toolbar"><input aria-label="Invite email" type="email" required placeholder="Invite someone by email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} /><button className="secondary">Create invitation</button></form>
      </>}
      <ul className="member-list">{members.map(member => <li key={member.id}><span>{member.name} · {member.email} ({member.project_role})</span>{member.id !== project?.manager_id && <button className="danger" onClick={() => removeMember(member)}>Remove</button>}</li>)}</ul>
    </section>}
    {selectedTask && <section className="setup">
      <h3>Discussion and attachments</h3>
      {comments.map(comment => <article key={comment.id} className="comment"><strong>{comment.user_name}</strong><p>{comment.content}</p><small>{new Date(comment.created_at).toLocaleString()}</small></article>)}
      {history.length > 0 && <details><summary>Status history</summary><ul>{history.map(item => <li key={item.id}>{item.old_status.replace('_',' ')} → {item.new_status.replace('_',' ')} by {item.changed_by_name || 'Unknown'} · {new Date(item.changed_at).toLocaleString()}</li>)}</ul></details>}
      <form onSubmit={handleAddComment} className="toolbar"><input aria-label="New comment" placeholder="Write a comment" value={commentText} onChange={event => setCommentText(event.target.value)} required maxLength={5000} /><button>Post comment</button></form>
      <ul className="member-list">{attachments.map(item => <li key={item.id}><button className="link-button" onClick={() => handleDownload(item)}>{item.file_name} ({Math.ceil(item.file_size / 1024)} KB)</button>{(canManage || item.uploaded_by === user?.id) && <button className="danger" onClick={async () => { try { await deleteAttachment(item.id); await openTaskDetails(selectedTask); } catch (err) { reportError(err); } }}>Remove</button>}</li>)}</ul>
      <form onSubmit={handleUpload} className="toolbar"><input name="file" type="file" aria-label="Choose attachment" required /><button>Upload file</button></form>
    </section>}
  </div>;
}
