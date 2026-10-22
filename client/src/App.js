import { Routes, Route, Link, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Home from './pages/Home';
import Login from './pages/Login';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Tasks from './pages/Tasks';
import Dashboard from './pages/Dashboard';
import AdminUsers from './pages/AdminUsers';
import AcceptInvite from './pages/AcceptInvite';
import './App.css';

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="empty-state">Loading your account…</p>;
  if (!user) return <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div>
      <header className="site-header">
        <h1>TaskManage</h1>
        <p>Project &amp; Task Management System</p>
        <nav aria-label="Primary">
          <Link to="/">Home</Link>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/projects">Projects</Link>
          {user && <Link to="/tasks">Tasks</Link>}
          {user?.role === 'admin' && <Link to="/admin">Admin</Link>}
          {user ? (
            <button className="secondary" onClick={handleLogout} style={{ padding: '.35rem .75rem', borderRadius: 6, fontWeight: 500, cursor: 'pointer', border: 'none', background: 'rgba(255,255,255,.15)', color: '#fff' }}>
              Logout
            </button>
          ) : (
            <Link to="/login">Login</Link>
          )}
        </nav>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
          <Route path="/projects/:id" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
          <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute adminOnly><AdminUsers /></ProtectedRoute>} />
        </Routes>
      </main>
      <footer className="footer" aria-label="Footer">
        <p>TaskManage — project planning, team collaboration, and task tracking.</p>
      </footer>
    </div>
  );
}
