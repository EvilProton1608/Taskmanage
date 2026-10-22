require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
  .split(',').map(origin => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '8mb' }));

const parseDatabaseConfig = () => {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return { connectionString, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } };
  }
  return {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    port: Number(process.env.DB_PORT || 5432),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
};

const pool = new Pool({ ...parseDatabaseConfig(), max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
app.locals.database = pool;
app.locals.closeDatabase = () => pool.end();
const JWT_SECRET = process.env.JWT_SECRET;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
const roles = ['admin', 'manager', 'member'];
const priorities = ['low', 'medium', 'high'];
const taskStatuses = ['todo', 'in_progress', 'completed'];
const projectStatuses = ['active', 'on_hold', 'completed', 'archived'];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const requiredText = (value, field, max = 255) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw httpError(400, `${field} is required and must be at most ${max} characters.`);
  }
  return value.trim();
};
const optionalText = (value, field, max = 10000) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw httpError(400, `${field} must be at most ${max} characters.`);
  return value.trim();
};
const validEnum = (value, options, field) => {
  if (!options.includes(value)) throw httpError(400, `${field} must be one of: ${options.join(', ')}.`);
  return value;
};
const validDate = (value, field) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw httpError(400, `${field} must be a valid date in YYYY-MM-DD format.`);
  }
  return value;
};
const pagination = query => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
};

const authenticate = asyncRoute(async (req, res, next) => {
  if (!JWT_SECRET) throw httpError(503, 'Authentication is not configured. Set JWT_SECRET and restart the API.');
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) throw httpError(401, 'Authentication required.');
  let payload;
  try { payload = jwt.verify(header.slice(7), JWT_SECRET); } catch (_) { throw httpError(401, 'Invalid or expired token.'); }
  const result = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [payload.id]);
  if (!result.rowCount) throw httpError(401, 'Account no longer exists.');
  req.user = result.rows[0];
  next();
});
const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) return next(httpError(401, 'Authentication required.'));
  if (!allowedRoles.includes(req.user.role)) return next(httpError(403, 'Insufficient permissions.'));
  next();
};
const requireProject = (managerOnly = false) => asyncRoute(async (req, res, next) => {
  const projectId = req.params.projectId || req.params.id;
  if (!uuidPattern.test(projectId || '')) throw httpError(400, 'Project ID must be a UUID.');
  const { rows } = await pool.query(`
    SELECT p.*, (p.manager_id = $2 OR pm.project_role = 'manager') AS is_manager,
           (p.manager_id = $2 OR pm.user_id IS NOT NULL) AS is_member
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
    WHERE p.id = $1
  `, [projectId, req.user.id]);
  const project = rows[0];
  if (!project) throw httpError(404, 'Project not found.');
  const isAdmin = req.user.role === 'admin';
  if (managerOnly ? (!isAdmin && !project.is_manager) : (!isAdmin && !project.is_member)) {
    throw httpError(403, 'You do not have access to this project.');
  }
  req.project = project;
  next();
});
const writeAudit = (userId, action, entityType, entityId, details, ip) => pool.query(
  `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [userId, action, entityType, entityId || null, JSON.stringify(details || {}), ip || null]
).catch(err => console.error('AUDIT WRITE FAILED:', err.message));
const newToken = () => crypto.randomBytes(32).toString('hex');
const tokenHash = value => crypto.createHash('sha256').update(value).digest('hex');
const removeStoredFiles = async paths => {
  await Promise.all(paths.map(filePath => fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(filePath))).catch(() => {})));
};
const requestBuckets = new Map();
const authRateLimit = (maxRequests, windowMs) => (req, res, next) => {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const bucket = requestBuckets.get(key);
  if (!bucket || bucket.startedAt + windowMs <= now) {
    requestBuckets.set(key, { startedAt: now, count: 1 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > maxRequests) return next(httpError(429, 'Too many attempts. Please wait and try again.'));
  next();
};
const sendEmail = async (to, subject, html) => {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
  });
  if (!response.ok) throw httpError(502, 'Email delivery failed. Please try again later.');
  return true;
};
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

app.get('/', (req, res) => res.json({ status: 'Task Management API', version: '2.0.0' }));
app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

// Authentication and account recovery
app.post('/api/auth/register', asyncRoute(async (req, res) => {
  if (!JWT_SECRET) throw httpError(503, 'Authentication is not configured. Set JWT_SECRET and restart the API.');
  const name = requiredText(req.body.name, 'Name');
  const email = requiredText(req.body.email, 'Email', 255).toLowerCase();
  const password = req.body.password;
  if (!emailPattern.test(email)) throw httpError(400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw httpError(400, 'Password must be 8–128 characters.');
  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email, hash, 'member']
    );
    const user = rows[0];
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    await writeAudit(user.id, 'user.register', 'user', user.id, {}, req.ip);
    res.status(201).json({ user, token });
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'An account with that email already exists.');
    throw err;
  }
}));
app.post('/api/auth/login', authRateLimit(12, 15 * 60 * 1000), asyncRoute(async (req, res) => {
  if (!JWT_SECRET) throw httpError(503, 'Authentication is not configured. Set JWT_SECRET and restart the API.');
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = req.body.password;
  if (!emailPattern.test(email) || typeof password !== 'string') throw httpError(400, 'Email and password are required.');
  const { rows } = await pool.query('SELECT id, name, email, role, password_hash FROM users WHERE email = $1', [email]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) throw httpError(401, 'Invalid email or password.');
  const user = (({ id, name, email: userEmail, role }) => ({ id, name, email: userEmail, role }))(rows[0]);
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  await writeAudit(user.id, 'user.login', 'user', user.id, {}, req.ip);
  res.json({ user, token });
}));
app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));
app.post('/api/auth/forgot-password', authRateLimit(5, 15 * 60 * 1000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!emailPattern.test(email)) throw httpError(400, 'Enter a valid email address.');
  const { rows } = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);
  let developmentToken;
  if (rows.length) {
    const rawToken = newToken();
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1 OR expires_at < NOW()', [rows[0].id]);
    await pool.query('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')', [rows[0].id, tokenHash(rawToken)]);
    const delivered = await sendEmail(email, 'Reset your TaskManage password', `<p>Use this password reset token:</p><p>${rawToken}</p><p>It expires in one hour.</p>`);
    if (!delivered && process.env.NODE_ENV !== 'production') developmentToken = rawToken;
  }
  res.json({ message: 'If that account exists, password reset instructions have been sent.', ...(developmentToken ? { development_token: developmentToken } : {}) });
}));
app.post('/api/auth/reset-password', asyncRoute(async (req, res) => {
  const token = requiredText(req.body.token, 'Reset token', 128);
  const password = req.body.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw httpError(400, 'Password must be 8–128 characters.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > NOW() AND used_at IS NULL FOR UPDATE', [tokenHash(token)]);
    if (!rows.length) throw httpError(400, 'Reset token is invalid or expired.');
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(password, 12), rows[0].user_id]);
    await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1', [rows[0].user_id]);
    await client.query('COMMIT');
    await writeAudit(rows[0].user_id, 'user.password_reset', 'user', rows[0].user_id, {}, req.ip);
    res.json({ message: 'Password reset successfully. Please sign in again.' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}));

// Admin user management
app.get('/api/users', authenticate, authorize('admin'), asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const { rows } = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
  const count = await pool.query('SELECT COUNT(*)::int AS total FROM users');
  res.json({ users: rows, pagination: { page, limit, total: count.rows[0].total } });
}));
app.patch('/api/users/:id/role', authenticate, authorize('admin'), asyncRoute(async (req, res) => {
  if (!uuidPattern.test(req.params.id)) throw httpError(400, 'User ID must be a UUID.');
  const role = validEnum(req.body.role, roles, 'Role');
  if (req.params.id === req.user.id && role !== 'admin') throw httpError(400, 'You cannot remove your own admin role.');
  const target = await pool.query('SELECT role FROM users WHERE id=$1', [req.params.id]);
  if (!target.rowCount) throw httpError(404, 'User not found.');
  if (target.rows[0].role === 'admin' && role !== 'admin') {
    const admins = await pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role='admin'");
    if (admins.rows[0].total <= 1) throw httpError(400, 'The last administrator cannot be demoted.');
  }
  const { rows } = await pool.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, role', [role, req.params.id]);
  if (!rows.length) throw httpError(404, 'User not found.');
  await writeAudit(req.user.id, 'user.role_update', 'user', req.params.id, { role }, req.ip);
  res.json({ user: rows[0] });
}));
app.delete('/api/users/:id', authenticate, authorize('admin'), asyncRoute(async (req, res) => {
  if (!uuidPattern.test(req.params.id)) throw httpError(400, 'User ID must be a UUID.');
  if (req.params.id === req.user.id) throw httpError(400, 'You cannot delete your own account while signed in.');
  const target = await pool.query('SELECT role FROM users WHERE id=$1', [req.params.id]);
  if (!target.rowCount) throw httpError(404, 'User not found.');
  if (target.rows[0].role === 'admin') {
    const admins = await pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role='admin'");
    if (admins.rows[0].total <= 1) throw httpError(400, 'The last administrator cannot be deleted.');
  }
  const files = await pool.query(`SELECT DISTINCT a.file_path FROM attachments a JOIN tasks t ON t.id=a.task_id JOIN projects p ON p.id=t.project_id
    WHERE a.uploaded_by=$1 OR t.created_by=$1 OR p.manager_id=$1`, [req.params.id]);
  const result = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (!result.rowCount) throw httpError(404, 'User not found.');
  await removeStoredFiles(files.rows.map(row => row.file_path));
  await writeAudit(req.user.id, 'user.delete', 'user', req.params.id, {}, req.ip);
  res.json({ message: 'User deleted.' });
}));
app.get('/api/audit-logs', authenticate, authorize('admin'), asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const { rows } = await pool.query(`SELECT a.*,u.name AS user_name,u.email AS user_email FROM audit_logs a
    LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`, [limit,offset]);
  const total = await pool.query('SELECT COUNT(*)::int AS total FROM audit_logs');
  res.json({ audit_logs: rows, pagination: { page,limit,total: total.rows[0].total } });
}));

// Projects
app.get('/api/projects', authenticate, asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const search = String(req.query.search || '').trim();
  const status = req.query.status ? validEnum(req.query.status, projectStatuses, 'Status') : null;
  const params = [req.user.id, req.user.role, `%${search}%`, status, limit, offset];
  const { rows } = await pool.query(`
    SELECT p.*, u.name AS manager_name,
      ($2='admin' OR p.manager_id=$1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$1 AND pm.project_role='manager')) AS can_manage
    FROM projects p JOIN users u ON u.id = p.manager_id
    WHERE ($2 = 'admin' OR p.manager_id = $1 OR EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1
    )) AND ($3 = '%%' OR p.title ILIKE $3 OR COALESCE(p.description, '') ILIKE $3)
      AND ($4::project_status IS NULL OR p.status = $4)
    ORDER BY p.created_at DESC LIMIT $5 OFFSET $6
  `, params);
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM projects p WHERE ($2 = 'admin' OR p.manager_id = $1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$1)) AND ($3='%%' OR p.title ILIKE $3 OR COALESCE(p.description,'') ILIKE $3) AND ($4::project_status IS NULL OR p.status=$4)`, [req.user.id, req.user.role, `%${search}%`, status]);
  res.json({ projects: rows, pagination: { page, limit, total: count.rows[0].total } });
}));
app.post('/api/projects', authenticate, authorize('admin', 'manager'), asyncRoute(async (req, res) => {
  const title = requiredText(req.body.title, 'Title');
  const description = optionalText(req.body.description, 'Description');
  const deadline = validDate(req.body.deadline, 'Deadline');
  const status = req.body.status ? validEnum(req.body.status, projectStatuses, 'Status') : 'active';
  let managerId = req.user.id;
  if (req.user.role === 'admin' && req.body.manager_id) {
    if (!uuidPattern.test(req.body.manager_id)) throw httpError(400, 'Manager ID must be a UUID.');
    const manager = await pool.query('SELECT id FROM users WHERE id=$1 AND role IN (\'manager\', \'admin\')', [req.body.manager_id]);
    if (!manager.rowCount) throw httpError(400, 'Selected project manager does not exist or has an incompatible role.');
    managerId = req.body.manager_id;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('INSERT INTO projects (title, description, manager_id, deadline, status) VALUES ($1,$2,$3,$4,$5) RETURNING *', [title, description, managerId, deadline, status]);
    await client.query('INSERT INTO project_members (project_id,user_id,project_role) VALUES ($1,$2,\'manager\') ON CONFLICT DO NOTHING', [rows[0].id, managerId]);
    await client.query('COMMIT');
    await writeAudit(req.user.id, 'project.create', 'project', rows[0].id, { title }, req.ip);
    res.status(201).json({ project: rows[0] });
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}));
app.get('/api/projects/:id', authenticate, requireProject(false), asyncRoute(async (req, res) => {
  res.json({ project: req.project });
}));
app.put('/api/projects/:id', authenticate, requireProject(true), asyncRoute(async (req, res) => {
  const { title, description, deadline, status } = req.body;
  if (title !== undefined) requiredText(title, 'Title');
  if (description !== undefined && description !== null) optionalText(description, 'Description');
  if (deadline !== undefined) validDate(deadline, 'Deadline');
  if (status !== undefined) validEnum(status, projectStatuses, 'Status');
  const { rows } = await pool.query(`UPDATE projects SET
    title = CASE WHEN $1::boolean THEN $2 ELSE title END,
    description = CASE WHEN $3::boolean THEN $4 ELSE description END,
    deadline = CASE WHEN $5::boolean THEN $6::date ELSE deadline END,
    status = COALESCE($7::project_status, status), updated_at=NOW()
    WHERE id=$8 RETURNING *`, [title !== undefined, title || null, description !== undefined, description ?? null, deadline !== undefined, deadline || null, status || null, req.project.id]);
  await writeAudit(req.user.id, 'project.update', 'project', req.project.id, req.body, req.ip);
  res.json({ project: rows[0] });
}));
app.delete('/api/projects/:id', authenticate, requireProject(true), asyncRoute(async (req, res) => {
  const files = await pool.query('SELECT a.file_path FROM attachments a JOIN tasks t ON t.id=a.task_id WHERE t.project_id=$1', [req.project.id]);
  await pool.query('DELETE FROM projects WHERE id=$1', [req.project.id]);
  await removeStoredFiles(files.rows.map(row => row.file_path));
  await writeAudit(req.user.id, 'project.delete', 'project', req.project.id, {}, req.ip);
  res.json({ message: 'Project deleted.' });
}));
app.patch('/api/projects/:id/manager', authenticate, authorize('admin'), requireProject(true), asyncRoute(async (req, res) => {
  const managerId = req.body.manager_id;
  if (!uuidPattern.test(managerId || '')) throw httpError(400, 'Manager ID must be a UUID.');
  const manager = await pool.query('SELECT id FROM users WHERE id=$1 AND role IN (\'admin\',\'manager\')', [managerId]);
  if (!manager.rowCount) throw httpError(400, 'Selected user must have the manager or admin role.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE projects SET manager_id=$1,updated_at=NOW() WHERE id=$2', [managerId,req.project.id]);
    await client.query('INSERT INTO project_members (project_id,user_id,project_role) VALUES ($1,$2,\'manager\') ON CONFLICT (project_id,user_id) DO UPDATE SET project_role=\'manager\'', [req.project.id,managerId]);
    if (req.project.manager_id !== managerId) await client.query('UPDATE project_members SET project_role=\'member\' WHERE project_id=$1 AND user_id=$2', [req.project.id,req.project.manager_id]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  await writeAudit(req.user.id, 'project.manager_change', 'project', req.project.id, { managerId }, req.ip);
  res.json({ message: 'Project manager changed.' });
}));

// Project membership and invitations
app.get('/api/projects/:projectId/members', authenticate, requireProject(false), asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT u.id,u.name,u.email,u.role,pm.project_role,pm.joined_at FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=$1 ORDER BY pm.joined_at', [req.project.id]);
  res.json({ members: rows });
}));
app.post('/api/projects/:projectId/members', authenticate, requireProject(true), asyncRoute(async (req, res) => {
  if (!req.project.is_manager) throw httpError(403, 'Only this project’s manager can add team members.');
  const email = requiredText(req.body.email, 'Email', 255).toLowerCase();
  if (!emailPattern.test(email)) throw httpError(400, 'Enter a valid email address.');
  const projectRole = req.body.project_role ? validEnum(req.body.project_role, ['manager', 'member'], 'Project role') : 'member';
  const { rows } = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
  if (!rows.length) throw httpError(404, 'No account exists for that email. Create an invitation to onboard a new member.');
  await pool.query('INSERT INTO project_members (project_id,user_id,project_role) VALUES ($1,$2,$3) ON CONFLICT (project_id,user_id) DO UPDATE SET project_role=EXCLUDED.project_role', [req.project.id, rows[0].id, projectRole]);
  await writeAudit(req.user.id, 'project.member_add', 'project', req.project.id, { email, projectRole }, req.ip);
  res.status(201).json({ message: 'Project member added.' });
}));
app.delete('/api/projects/:projectId/members/:userId', authenticate, requireProject(true), asyncRoute(async (req, res) => {
  if (!uuidPattern.test(req.params.userId)) throw httpError(400, 'User ID must be a UUID.');
  if (req.params.userId === req.project.manager_id) throw httpError(400, 'Transfer project ownership before removing its manager.');
  const result = await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2', [req.project.id, req.params.userId]);
  if (!result.rowCount) throw httpError(404, 'Project member not found.');
  await writeAudit(req.user.id, 'project.member_remove', 'project', req.project.id, { userId: req.params.userId }, req.ip);
  res.json({ message: 'Project member removed.' });
}));
app.post('/api/projects/:projectId/invitations', authenticate, requireProject(true), asyncRoute(async (req, res) => {
  if (!req.project.is_manager) throw httpError(403, 'Only this project’s manager can invite team members.');
  const email = requiredText(req.body.email, 'Email', 255).toLowerCase();
  if (!emailPattern.test(email)) throw httpError(400, 'Enter a valid email address.');
  const rawToken = newToken();
  await pool.query('INSERT INTO project_invitations (project_id,email,token_hash,invited_by,expires_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL \'7 days\') ON CONFLICT (project_id,email) DO UPDATE SET token_hash=EXCLUDED.token_hash,invited_by=EXCLUDED.invited_by,expires_at=EXCLUDED.expires_at,accepted_at=NULL', [req.project.id,email,tokenHash(rawToken),req.user.id]);
  const link = `${process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:3000'}/accept-invite?token=${rawToken}`;
  const sent = await sendEmail(email, `Invitation to ${req.project.title}`, `<p>You have been invited to join ${escapeHtml(req.project.title)}.</p><p><a href="${link}">Accept invitation</a></p>`);
  await writeAudit(req.user.id, 'project.invite', 'project', req.project.id, { email }, req.ip);
  res.status(201).json({ message: sent ? 'Invitation sent.' : 'Invitation created. Share the link with the invitee.', ...(!sent ? { invitation_url: link } : {}) });
}));
app.post('/api/projects/invitations/accept', authenticate, asyncRoute(async (req, res) => {
  const token = requiredText(req.body.token, 'Invitation token', 128);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM project_invitations WHERE token_hash=$1 AND lower(email)=lower($2) AND expires_at>NOW() AND accepted_at IS NULL FOR UPDATE', [tokenHash(token),req.user.email]);
    if (!rows.length) throw httpError(400, 'Invitation is invalid, expired, or belongs to another email address.');
    await client.query('INSERT INTO project_members (project_id,user_id,project_role) VALUES ($1,$2,\'member\') ON CONFLICT DO NOTHING', [rows[0].project_id,req.user.id]);
    await client.query('UPDATE project_invitations SET accepted_at=NOW() WHERE id=$1', [rows[0].id]);
    await client.query('COMMIT');
    await writeAudit(req.user.id, 'project.invitation_accept', 'project', rows[0].project_id, {}, req.ip);
    res.json({ message: 'Invitation accepted.' });
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}));

// Tasks
app.get('/api/projects/:projectId/tasks', authenticate, requireProject(false), asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const search = String(req.query.search || '').trim();
  const status = req.query.status ? validEnum(req.query.status, taskStatuses, 'Status') : null;
  const priority = req.query.priority ? validEnum(req.query.priority, priorities, 'Priority') : null;
  const orderBy = ({ due_date: 't.due_date ASC NULLS LAST', priority: 't.priority DESC', title: 't.title ASC' })[req.query.sort] || 't.created_at DESC';
  const { rows } = await pool.query(`SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
    WHERE t.project_id=$1 AND ($2='%%' OR t.title ILIKE $2 OR COALESCE(t.description,'') ILIKE $2)
    AND ($3::task_status IS NULL OR t.status=$3) AND ($4::task_priority IS NULL OR t.priority=$4)
    ORDER BY ${orderBy} LIMIT $5 OFFSET $6`, [req.project.id,`%${search}%`,status,priority,limit,offset]);
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM tasks t WHERE t.project_id=$1 AND ($2='%%' OR t.title ILIKE $2 OR COALESCE(t.description,'') ILIKE $2) AND ($3::task_status IS NULL OR t.status=$3) AND ($4::task_priority IS NULL OR t.priority=$4)`, [req.project.id,`%${search}%`,status,priority]);
  res.json({ tasks: rows, pagination: { page, limit, total: count.rows[0].total } });
}));
app.post('/api/tasks', authenticate, asyncRoute(async (req, res) => {
  const title = requiredText(req.body.title, 'Title');
  const projectId = req.body.project_id;
  if (!uuidPattern.test(projectId || '')) throw httpError(400, 'Project ID must be a UUID.');
  const { rows: projects } = await pool.query('SELECT id,manager_id FROM projects WHERE id=$1', [projectId]);
  if (!projects.length) throw httpError(404, 'Project not found.');
  const membership = await pool.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2', [projectId,req.user.id]);
  if (req.user.role !== 'admin' && projects[0].manager_id !== req.user.id && !membership.rowCount) throw httpError(403, 'You do not have access to this project.');
  const description = optionalText(req.body.description, 'Description');
  const priority = req.body.priority ? validEnum(req.body.priority, priorities, 'Priority') : 'medium';
  const status = req.body.status ? validEnum(req.body.status, taskStatuses, 'Status') : 'todo';
  const dueDate = validDate(req.body.due_date, 'Due date');
  const assigneeId = req.body.assignee_id || null;
  if (assigneeId) {
    const assignee = await pool.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM projects WHERE id=$1 AND manager_id=$2', [projectId,assigneeId]);
    if (!assignee.rowCount) throw httpError(400, 'Assignee must be a member of this project.');
  }
  const { rows } = await pool.query('INSERT INTO tasks (title,description,project_id,assignee_id,priority,status,due_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [title,description,projectId,assigneeId,priority,status,dueDate,req.user.id]);
  await writeAudit(req.user.id, 'task.create', 'task', rows[0].id, { projectId, title }, req.ip);
  res.status(201).json({ task: rows[0] });
}));
app.put('/api/tasks/:id', authenticate, asyncRoute(async (req, res) => {
  if (!uuidPattern.test(req.params.id)) throw httpError(400, 'Task ID must be a UUID.');
  const { rows: currentRows } = await pool.query('SELECT t.*,p.manager_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1', [req.params.id]);
  const current = currentRows[0];
  if (!current) throw httpError(404, 'Task not found.');
  const member = await pool.query('SELECT project_role FROM project_members WHERE project_id=$1 AND user_id=$2', [current.project_id,req.user.id]);
  const isManager = req.user.role === 'admin' || current.manager_id === req.user.id || member.rows[0]?.project_role === 'manager';
  if (!isManager && !member.rowCount) throw httpError(403, 'You do not have access to this task.');
  if (!isManager && current.assignee_id !== req.user.id) throw httpError(403, 'Members can edit only tasks assigned to them.');
  const updates = { title: req.body.title === undefined ? current.title : requiredText(req.body.title,'Title'), description: req.body.description === undefined ? current.description : optionalText(req.body.description,'Description'), priority: req.body.priority === undefined ? current.priority : validEnum(req.body.priority,priorities,'Priority'), status: req.body.status === undefined ? current.status : validEnum(req.body.status,taskStatuses,'Status'), due_date: req.body.due_date === undefined ? current.due_date : validDate(req.body.due_date,'Due date') };
  let assigneeId = current.assignee_id;
  if (req.body.assignee_id !== undefined) {
    assigneeId = req.body.assignee_id || null;
    if (assigneeId) {
      const eligible = await pool.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM projects WHERE id=$1 AND manager_id=$2', [current.project_id,assigneeId]);
      if (!eligible.rowCount) throw httpError(400, 'Assignee must be a member of this project.');
    }
  }
  const { rows } = await pool.query('UPDATE tasks SET title=$1,description=$2,assignee_id=$3,priority=$4,status=$5,due_date=$6,updated_at=NOW() WHERE id=$7 RETURNING *', [updates.title,updates.description,assigneeId,updates.priority,updates.status,updates.due_date,req.params.id]);
  if (current.status !== updates.status) await pool.query('INSERT INTO task_status_history (task_id,changed_by,old_status,new_status) VALUES ($1,$2,$3,$4)', [req.params.id,req.user.id,current.status,updates.status]);
  await writeAudit(req.user.id, 'task.update', 'task', req.params.id, req.body, req.ip);
  res.json({ task: rows[0] });
}));
app.delete('/api/tasks/:id', authenticate, asyncRoute(async (req, res) => {
  if (!uuidPattern.test(req.params.id)) throw httpError(400, 'Task ID must be a UUID.');
  const { rows } = await pool.query('SELECT t.id,t.project_id,p.manager_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1', [req.params.id]);
  if (!rows.length) throw httpError(404, 'Task not found.');
  const membership = await pool.query('SELECT project_role FROM project_members WHERE project_id=$1 AND user_id=$2', [rows[0].project_id,req.user.id]);
  if (req.user.role !== 'admin' && rows[0].manager_id !== req.user.id && membership.rows[0]?.project_role !== 'manager') throw httpError(403, 'Only a project manager or admin can delete tasks.');
  const files = await pool.query('SELECT file_path FROM attachments WHERE task_id=$1', [req.params.id]);
  await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
  await removeStoredFiles(files.rows.map(row => row.file_path));
  await writeAudit(req.user.id, 'task.delete', 'task', req.params.id, {}, req.ip);
  res.json({ message: 'Task deleted.' });
}));
app.get('/api/tasks/:taskId/history', authenticate, asyncRoute(async (req, res) => {
  const task = await pool.query('SELECT project_id FROM tasks WHERE id=$1', [req.params.taskId]);
  if (!task.rowCount) throw httpError(404, 'Task not found.');
  const access = await pool.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM projects WHERE id=$1 AND manager_id=$2', [task.rows[0].project_id,req.user.id]);
  if (!access.rowCount && req.user.role !== 'admin') throw httpError(403, 'You do not have access to this task.');
  const { rows } = await pool.query('SELECT h.*,u.name AS changed_by_name FROM task_status_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.task_id=$1 ORDER BY h.changed_at DESC', [req.params.taskId]);
  res.json({ history: rows });
}));

// Comments
app.get('/api/tasks/:taskId/comments', authenticate, asyncRoute(async (req, res) => {
  if (!uuidPattern.test(req.params.taskId)) throw httpError(400, 'Task ID must be a UUID.');
  const { rows: tasks } = await pool.query('SELECT project_id FROM tasks WHERE id=$1', [req.params.taskId]);
  if (!tasks.length) throw httpError(404, 'Task not found.');
  const membership = await pool.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM projects WHERE id=$1 AND manager_id=$2', [tasks[0].project_id,req.user.id]);
  if (!membership.rowCount && req.user.role !== 'admin') throw httpError(403, 'You do not have access to this task.');
  const { rows } = await pool.query('SELECT c.*,u.name AS user_name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=$1 ORDER BY c.created_at', [req.params.taskId]);
  res.json({ comments: rows });
}));
app.post('/api/tasks/:taskId/comments', authenticate, asyncRoute(async (req, res) => {
  const content = requiredText(req.body.content, 'Comment', 5000);
  const { rows: tasks } = await pool.query('SELECT project_id FROM tasks WHERE id=$1', [req.params.taskId]);
  if (!tasks.length) throw httpError(404, 'Task not found.');
  const member = await pool.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM projects WHERE id=$1 AND manager_id=$2', [tasks[0].project_id,req.user.id]);
  if (!member.rowCount && req.user.role !== 'admin') throw httpError(403, 'You do not have access to this task.');
  const { rows } = await pool.query('INSERT INTO comments (task_id,user_id,content) VALUES ($1,$2,$3) RETURNING *', [req.params.taskId,req.user.id,content]);
  await writeAudit(req.user.id, 'comment.create', 'task', req.params.taskId, {}, req.ip);
  res.status(201).json({ comment: rows[0] });
}));

// File uploads use JSON base64 payloads. The size is bounded by express.json and the file check below.
app.get('/api/tasks/:taskId/attachments', authenticate, asyncRoute(async (req, res) => {
  const task = await pool.query('SELECT project_id FROM tasks WHERE id=$1', [req.params.taskId]);
  if (!task.rowCount) throw httpError(404, 'Task not found.');
  const access = await pool.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM projects WHERE id=$1 AND manager_id=$2', [task.rows[0].project_id,req.user.id]);
  if (!access.rowCount && req.user.role !== 'admin') throw httpError(403, 'You do not have access to this task.');
  const { rows } = await pool.query('SELECT id,file_name,file_size,mime_type,uploaded_by,uploaded_at FROM attachments WHERE task_id=$1 ORDER BY uploaded_at DESC', [req.params.taskId]);
  res.json({ attachments: rows });
}));
app.post('/api/tasks/:taskId/attachments', authenticate, asyncRoute(async (req, res) => {
  const fileName = requiredText(req.body.file_name, 'File name', 255);
  const safeFileName = path.basename(fileName.replace(/\\/g, '/')).replace(/[\r\n\0]/g, '');
  if (!safeFileName) throw httpError(400, 'File name is invalid.');
  const mimeType = optionalText(req.body.mime_type, 'MIME type', 100);
  const encoded = req.body.data;
  if (typeof encoded !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw httpError(400, 'File data must be valid base64.');
  const data = Buffer.from(encoded, 'base64');
  if (!data.length || data.length > 5 * 1024 * 1024) throw httpError(413, 'Files must be between 1 byte and 5 MB.');
  const task = await pool.query('SELECT project_id FROM tasks WHERE id=$1', [req.params.taskId]);
  if (!task.rowCount) throw httpError(404, 'Task not found.');
  const access = await pool.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM projects WHERE id=$1 AND manager_id=$2', [task.rows[0].project_id,req.user.id]);
  if (!access.rowCount && req.user.role !== 'admin') throw httpError(403, 'You do not have access to this task.');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const storageName = `${crypto.randomUUID()}.upload`;
  const storagePath = path.join(UPLOAD_DIR, storageName);
  await fs.promises.writeFile(storagePath, data, { flag: 'wx' });
  try {
    const { rows } = await pool.query('INSERT INTO attachments (task_id,file_name,file_path,file_size,mime_type,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,file_name,file_size,mime_type,uploaded_at', [req.params.taskId,safeFileName,storageName,data.length,mimeType,req.user.id]);
    await writeAudit(req.user.id, 'attachment.upload', 'task', req.params.taskId, { fileName: safeFileName }, req.ip);
    res.status(201).json({ attachment: rows[0] });
  } catch (err) { await fs.promises.unlink(storagePath).catch(() => {}); throw err; }
}));
app.get('/api/attachments/:id/download', authenticate, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT a.*,t.project_id FROM attachments a JOIN tasks t ON t.id=a.task_id WHERE a.id=$1', [req.params.id]);
  if (!rows.length) throw httpError(404, 'Attachment not found.');
  const access = await pool.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 UNION SELECT 1 FROM projects WHERE id=$1 AND manager_id=$2', [rows[0].project_id,req.user.id]);
  if (!access.rowCount && req.user.role !== 'admin') throw httpError(403, 'You do not have access to this file.');
  const filePath = path.join(UPLOAD_DIR, path.basename(rows[0].file_path));
  if (!fs.existsSync(filePath)) throw httpError(404, 'Attachment file is missing from storage.');
  res.download(filePath, rows[0].file_name);
}));
app.delete('/api/attachments/:id', authenticate, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT a.*,t.project_id,p.manager_id FROM attachments a JOIN tasks t ON t.id=a.task_id JOIN projects p ON p.id=t.project_id WHERE a.id=$1', [req.params.id]);
  if (!rows.length) throw httpError(404, 'Attachment not found.');
  const item = rows[0];
  const access = await pool.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 AND project_role=\'manager\'', [item.project_id,req.user.id]);
  if (req.user.role !== 'admin' && item.manager_id !== req.user.id && item.uploaded_by !== req.user.id && !access.rowCount) throw httpError(403, 'You cannot remove this attachment.');
  await pool.query('DELETE FROM attachments WHERE id=$1', [req.params.id]);
  await removeStoredFiles([item.file_path]);
  await writeAudit(req.user.id, 'attachment.delete', 'task', item.task_id, {}, req.ip);
  res.json({ message: 'Attachment deleted.' });
}));

// Dashboard, scoped to projects visible to the current user.
const dashboardScope = `($2='admin' OR p.manager_id=$1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$1))`;
app.get('/api/dashboard/progress', authenticate, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`SELECT p.id::text,p.title,p.deadline,
    COUNT(*) FILTER (WHERE t.status='completed') AS completed,
    COUNT(*) FILTER (WHERE t.status='in_progress') AS in_progress,
    COUNT(*) FILTER (WHERE t.status='todo') AS todo,COUNT(t.id) AS total
    FROM projects p LEFT JOIN tasks t ON t.project_id=p.id WHERE ${dashboardScope}
    GROUP BY p.id,p.title,p.deadline ORDER BY p.title`, [req.user.id,req.user.role]);
  res.json({ progress: rows });
}));
app.get('/api/dashboard/upcoming', authenticate, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`SELECT t.id,t.title,t.priority,t.due_date,t.status,u.name AS assignee_name,p.title AS project_title,
    t.due_date-CURRENT_DATE AS days_until_due
    FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.assignee_id
    WHERE t.status <> 'completed' AND t.due_date IS NOT NULL AND ${dashboardScope}
    ORDER BY t.due_date ASC LIMIT 10`, [req.user.id,req.user.role]);
  res.json({ upcoming: rows });
}));
app.get('/api/dashboard/statistics', authenticate, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`SELECT
    COUNT(t.id) FILTER (WHERE t.status='completed') AS completed,
    COUNT(t.id) FILTER (WHERE t.status='in_progress') AS in_progress,
    COUNT(t.id) FILTER (WHERE t.status='todo') AS pending,COUNT(t.id) AS total
    FROM projects p LEFT JOIN tasks t ON t.project_id=p.id WHERE ${dashboardScope}`, [req.user.id,req.user.role]);
  const team = await pool.query(`SELECT u.id,u.name,COUNT(t.id) AS task_count,
    COUNT(t.id) FILTER (WHERE t.status='completed') AS completed
    FROM projects p JOIN project_members pm ON pm.project_id=p.id JOIN users u ON u.id=pm.user_id
    LEFT JOIN tasks t ON t.project_id=p.id AND t.assignee_id=u.id WHERE ${dashboardScope}
    GROUP BY u.id,u.name ORDER BY u.name`, [req.user.id,req.user.role]);
  res.json({ statistics: rows[0], team_performance: team.rows });
}));

// API errors never return SQL details to clients.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code) console.error('DATABASE/API ERROR:', err.code, err.message);
  else if ((err.status || 500) >= 500) console.error('API ERROR:', err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error.' });
});
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

const PORT = Number(process.env.PORT || 5000);
if (require.main === module) {
  if (!JWT_SECRET) console.error('JWT_SECRET is not set. Authentication requests will be rejected.');
  app.listen(PORT, () => console.log(`Task Management API listening on port ${PORT}`));
}

module.exports = app;
