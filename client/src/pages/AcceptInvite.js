import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { acceptProjectInvite } from '../api';
import { useAuth } from '../contexts/AuthContext';

export default function AcceptInvite() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const token = params.get('token') || '';

  useEffect(() => {
    if (!user || !token) return;
    acceptProjectInvite(token).then(({ data }) => setMessage(data.message)).catch(err => setError(err.response?.data?.error || 'Invitation could not be accepted.'));
  }, [user, token]);

  if (!user) return <section className="setup"><h2>Project invitation</h2><p>Sign in or create an account using the invited email address to accept this invitation.</p><Link to="/login" state={{ from: `${location.pathname}${location.search}` }}>Continue to sign in</Link></section>;
  return <section className="setup"><h2>Project invitation</h2>{message && <p role="status">{message} <Link to="/projects">View projects</Link></p>}{error && <p role="alert" className="error-message">{error}</p>}</section>;
}
