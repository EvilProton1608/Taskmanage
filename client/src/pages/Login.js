import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { requestPasswordReset, resetPassword } from '../api';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isLogin, setIsLogin] = useState(true);
  const [isReset, setIsReset] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      if (isReset) {
        const { data } = await requestPasswordReset(email);
        setMessage(data.development_token
          ? `${data.message} Development token: ${data.development_token}`
          : data.message);
        if (data.development_token) setResetToken(data.development_token);
        return;
      }
      if (isLogin) await login(email, password);
      else await register(name, email, password);
      navigate(location.state?.from || '/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const { data } = await resetPassword(resetToken.trim(), newPassword);
      setMessage(data.message);
      setPassword('');
      setNewPassword('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset the password.');
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '2rem auto', padding: '1.5rem', background: '#fff', borderRadius: 14, boxShadow: '0 4px 16px rgba(0,0,0,.06)', border: '1px solid #ececf3' }}>
      <h2 style={{ marginBottom: '1rem' }}>{isReset ? 'Password recovery' : isLogin ? 'Sign In' : 'Create Account'}</h2>
      {error && <p role="alert" style={{ color: '#c00', marginBottom: '.75rem' }}>{error}</p>}
      {message && <p role="status">{message}</p>}
      <form onSubmit={handleSubmit}>
        {!isLogin && !isReset && <><label htmlFor="name">Name</label><input id="name" required maxLength={255} value={name} onChange={event => setName(event.target.value)} placeholder="Your name" /></>}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
        {!isReset && <><label htmlFor="password">Password</label><input id="password" type="password" required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" /></>}
        <button type="submit" style={{ marginTop: '.5rem' }}>{isReset ? 'Send reset instructions' : isLogin ? 'Sign In' : 'Create Account'}</button>
      </form>
      {isReset && <form onSubmit={handleReset} className="setup">
        <h3>Complete password reset</h3>
        <label htmlFor="reset-token">Reset token</label>
        <input id="reset-token" required value={resetToken} onChange={event => setResetToken(event.target.value)} />
        <label htmlFor="new-password">New password</label>
        <input id="new-password" type="password" required minLength={8} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} />
        <button type="submit">Reset password</button>
      </form>}
      <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '.9rem', color: '#555' }}>
        {isReset ? 'Remembered your password?' : isLogin ? 'New here?' : 'Already have an account?'}
        <button className="secondary" onClick={() => { setIsReset(false); setIsLogin(isReset ? true : !isLogin); setError(''); setMessage(''); }} style={{ marginLeft: '.5rem', padding: '.35rem .6rem' }}>
          {isReset ? 'Back to sign in' : isLogin ? 'Register' : 'Sign in'}
        </button>
      </p>
      {isLogin && <p style={{ textAlign: 'center' }}><button className="secondary" onClick={() => { setIsReset(true); setError(''); setMessage(''); }}>Forgot password?</button></p>}
    </div>
  );
}
