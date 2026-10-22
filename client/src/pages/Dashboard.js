import { useEffect, useState } from 'react';
import { getDashboardProgress, getDashboardUpcoming, getDashboardStats } from '../api';

export default function Dashboard() {
  const [progress, setProgress] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [stats, setStats] = useState({ completed: 0, in_progress: 0, pending: 0, total: 0 });
  const [team, setTeam] = useState([]);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    Promise.allSettled([
      getDashboardProgress(),
      getDashboardUpcoming(),
      getDashboardStats(),
    ]).then(([progressResult, upcomingResult, statsResult]) => {
      const failedRequests = [];
      const readResult = (result, label, key, setter) => {
        if (result.status === 'fulfilled') {
          setter(result.value.data[key] || (key === 'statistics' ? {} : []));
          return;
        }
        const responseData = result.reason?.response?.data;
        const serverMessage = responseData?.detail || responseData?.error;
        failedRequests.push(`${label}${serverMessage ? `: ${serverMessage}` : ''}`);
      };

      readResult(progressResult, 'Project progress', 'progress', setProgress);
      readResult(upcomingResult, 'Upcoming deadlines', 'upcoming', setUpcoming);
      readResult(statsResult, 'Task statistics', 'statistics', setStats);
      if (statsResult.status === 'fulfilled') setTeam(statsResult.value.data.team_performance || []);
      setErrors(failedRequests);
    });
  }, []);

  return (
    <div>
      <h2>Dashboard</h2>
      {errors.length > 0 && (
        <div role="alert" style={{ color: '#c00' }}>
          <p>Some dashboard data could not be loaded:</p>
          <ul>{errors.map(error => <li key={error}>{error}</li>)}</ul>
          <p>Check the API server output for the database error, then restart the API after applying any code changes.</p>
        </div>
      )}
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <article className="card"><h3>Completed</h3><p style={{ fontSize: '2rem', fontWeight: 700 }}>{stats.completed || 0}</p></article>
        <article className="card"><h3>In Progress</h3><p style={{ fontSize: '2rem', fontWeight: 700 }}>{stats.in_progress || 0}</p></article>
        <article className="card"><h3>Pending</h3><p style={{ fontSize: '2rem', fontWeight: 700 }}>{stats.pending || 0}</p></article>
        <article className="card"><h3>Total</h3><p style={{ fontSize: '2rem', fontWeight: 700 }}>{stats.total || 0}</p></article>
      </div>

      <section className="setup" style={{ marginTop: '1.5rem' }}>
        <h2>Project Progress</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.9rem' }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}><th>Project</th><th>Completed</th><th>In Progress</th><th>Pending</th><th>Total</th></tr></thead>
          <tbody>
            {progress.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>{p.title}</td>
                <td>{p.completed || 0}</td>
                <td>{p.in_progress || 0}</td>
                <td>{p.todo || 0}</td>
                <td>{p.total || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="setup" style={{ marginTop: '1.5rem' }}>
        <h2>Team performance</h2>
        <div className="table-scroll"><table><thead><tr><th>Member</th><th>Tasks</th><th>Completed</th></tr></thead>
          <tbody>{team.map(member => <tr key={member.id}><td>{member.name}</td><td>{member.task_count || 0}</td><td>{member.completed || 0}</td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="setup" style={{ marginTop: '1.5rem' }}>
        <h2>Upcoming Deadlines</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.9rem' }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}><th>Task</th><th>Project</th><th>Assignee</th><th>Priority</th><th>Days Left</th></tr></thead>
          <tbody>
            {upcoming.map(t => (
              <tr key={t.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>{t.title}</td><td>{t.project_title}</td><td>{t.assignee_name || 'Unassigned'}</td><td>{t.priority}</td><td style={{ color: Number(t.days_until_due) <= 0 ? '#9c1c1c' : undefined, fontWeight: Number(t.days_until_due) <= 0 ? 700 : undefined }}>{Number(t.days_until_due) <= 0 ? `Overdue by ${Math.abs(Number(t.days_until_due))} day(s)` : `${t.days_until_due} day(s)`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
