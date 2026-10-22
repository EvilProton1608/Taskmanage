import { useAuth } from '../contexts/AuthContext';

export default function Home() {
  const { user } = useAuth();
  return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem', maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: '3rem', letterSpacing: '-0.03em', marginBottom: '.5rem' }}>TaskManage</h1>
      <p style={{ fontSize: '1.2rem', color: '#555', marginBottom: '1rem' }}>
        Plan projects, assign work, and keep track of task deadlines and progress.
      </p>
      <div style={{ background: '#fff', borderRadius: 14, padding: '1.5rem 2rem', boxShadow: '0 4px 16px rgba(0,0,0,.06)', border: '1px solid #ececf3', marginBottom: '2rem', textAlign: 'left' }}>
        <h2 style={{ marginBottom: '.75rem', fontSize: '1.1rem' }}>Features</h2>
        <ul style={{ paddingLeft: '1.2rem', lineHeight: 1.7, color: '#333' }}>
          <li><strong>Projects</strong> — Create projects, set deadlines, and assign a manager.</li>
          <li><strong>Tasks</strong> — Assign work, set priority and due dates, and move tasks through their status.</li>
          <li><strong>Project teams</strong> — Add existing accounts or invite people to join.</li>
          <li><strong>Progress</strong> — Review task totals, project progress, and upcoming or overdue work.</li>
          <li><strong>Task discussion</strong> — Leave comments, attach files, and review status changes.</li>
        </ul>
      </div>
      {!user && <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <a href="/login" style={{ padding: '.7rem 1.5rem', background: '#16213e', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: '.95rem' }}>Log in</a>
        <a href="/login" style={{ padding: '.7rem 1.5rem', background: '#ececf3', color: '#1a1a2e', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: '.95rem' }}>Get started</a>
      </div>}
    </div>
  );
}
