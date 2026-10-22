const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const app = require('../server/index');

jest.setTimeout(60000);

const suffix = crypto.randomUUID();
const createdUserIds = [];
const createdEntityIds = [];
let manager;
let member;
let outsider;
let secondManager;
let admin;
let project;
let otherProject;
let task;
let uploadedAttachment;

async function register(email, role = 'member') {
  const response = await request(app).post('/api/auth/register').send({ name: `Test ${suffix}`, email, password: `Safe-${suffix}-Pass9`, role });
  expect(response.status).toBe(201);
  createdUserIds.push(response.body.user.id);
  return { user: response.body.user, token: response.body.token };
}

const auth = account => ({ Authorization: `Bearer ${account.token}` });

beforeAll(async () => {
  manager = await register(`manager-${suffix}@example.invalid`, 'admin');
  expect(manager.user.role).toBe('member'); // Public signup must never grant elevated roles.
  await app.locals.database.query("UPDATE users SET role='manager' WHERE id=$1", [manager.user.id]);
  secondManager = await register(`manager-two-${suffix}@example.invalid`);
  await app.locals.database.query("UPDATE users SET role='manager' WHERE id=$1", [secondManager.user.id]);
  member = await register(`member-${suffix}@example.invalid`);
  outsider = await register(`outsider-${suffix}@example.invalid`);
  admin = await register(`admin-${suffix}@example.invalid`);
  await app.locals.database.query("UPDATE users SET role='admin' WHERE id=$1", [admin.user.id]);
});

afterAll(async () => {
  if (createdUserIds.length) {
    const attachments = await app.locals.database.query('SELECT file_path FROM attachments WHERE uploaded_by=ANY($1::uuid[])', [createdUserIds]);
    await Promise.all(attachments.rows.map(item => fs.unlink(path.join(__dirname, '..', 'server', 'uploads', path.basename(item.file_path))).catch(() => {})));
    await app.locals.database.query('DELETE FROM audit_logs WHERE user_id=ANY($1::uuid[]) OR entity_id=ANY($2::uuid[])', [createdUserIds,createdEntityIds]);
    await app.locals.database.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [createdUserIds]);
  }
  await app.locals.closeDatabase();
});

describe('TaskManage API and database integration', () => {
  it('validates input and refuses unauthenticated access', async () => {
    const health = await request(app).get('/');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('Task Management API');
    expect((await request(app).get('/api/projects')).status).toBe(401);
    expect((await request(app).post('/api/auth/register').send({ name: '', email: 'bad', password: 'short', role: 'admin' })).status).toBe(400);
    expect((await request(app).post('/api/projects').set(auth(member)).send({ title: 'Forbidden' })).status).toBe(403);
    expect((await request(app).post('/api/projects').set(auth(manager)).send({ title: 'Bad date', deadline: '2026-02-31' })).status).toBe(400);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('supports scoped project, member, task, comment, file, audit, and dashboard workflows', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: manager.user.email, password: `Safe-${suffix}-Pass9` });
    expect(login.status).toBe(200);
    manager.token = login.body.token;

    let response = await request(app).post('/api/projects').set(auth(manager)).send({ title: `Project ${suffix}`, description: 'Integration test', deadline: '2099-01-01' });
    expect(response.status).toBe(201);
    project = response.body.project;
    createdEntityIds.push(project.id);
    response = await request(app).post('/api/projects').set(auth(secondManager)).send({ title: `Other project ${suffix}` });
    expect(response.status).toBe(201);
    otherProject = response.body.project;
    createdEntityIds.push(otherProject.id);

    response = await request(app).put(`/api/projects/${project.id}`).set(auth(manager)).send({ description: 'Updated description', deadline: null });
    expect(response.status).toBe(200);
    expect(response.body.project.description).toBe('Updated description');
    expect(response.body.project.deadline).toBeNull();
    expect((await request(app).get(`/api/projects?search=${encodeURIComponent(`Project ${suffix}`)}&page=1&limit=5`).set(auth(manager))).body.projects).toHaveLength(1);

    expect((await request(app).put(`/api/projects/${otherProject.id}`).set(auth(manager)).send({ title: 'No access' })).status).toBe(403);
    expect((await request(app).delete(`/api/projects/${otherProject.id}`).set(auth(manager))).status).toBe(403);
    expect((await request(app).get(`/api/projects/${otherProject.id}`).set(auth(member))).status).toBe(403);

    expect((await request(app).post(`/api/projects/${project.id}/members`).set(auth(admin)).send({ email: outsider.user.email })).status).toBe(403);
    expect((await request(app).post(`/api/projects/${project.id}/invitations`).set(auth(admin)).send({ email: outsider.user.email })).status).toBe(403);
    expect((await request(app).post(`/api/projects/${project.id}/members`).set(auth(manager)).send({ email: member.user.email })).status).toBe(201);
    expect((await request(app).get(`/api/projects/${project.id}/members`).set(auth(manager))).body.members).toHaveLength(2);
    response = await request(app).post('/api/tasks').set(auth(manager)).send({ title: 'Test task', project_id: project.id, assignee_id: member.user.id, priority: 'high', due_date: '2099-01-01' });
    expect(response.status).toBe(201);
    task = response.body.task;
    createdEntityIds.push(task.id);
    expect((await request(app).get(`/api/projects/${project.id}/tasks?priority=high&search=Test&page=1&limit=5`).set(auth(member))).body.tasks).toHaveLength(1);
    expect((await request(app).get(`/api/projects/${project.id}/tasks`).set(auth(outsider))).status).toBe(403);
    expect((await request(app).put(`/api/tasks/${task.id}`).set(auth(outsider)).send({ status: 'completed' })).status).toBe(403);

    expect((await request(app).put(`/api/tasks/${task.id}`).set(auth(member)).send({ status: 'in_progress' })).status).toBe(200);
    expect((await request(app).get(`/api/tasks/${task.id}/history`).set(auth(member))).body.history).toHaveLength(1);
    expect((await request(app).post(`/api/tasks/${task.id}/comments`).set(auth(member)).send({ content: 'Hello from member' })).status).toBe(201);
    expect((await request(app).get(`/api/tasks/${task.id}/comments`).set(auth(member))).body.comments).toHaveLength(1);

    const data = Buffer.from('temporary attachment content').toString('base64');
    response = await request(app).post(`/api/tasks/${task.id}/attachments`).set(auth(member)).send({ file_name: 'test.txt', mime_type: 'text/plain', data });
    expect(response.status).toBe(201);
    uploadedAttachment = response.body.attachment;
    expect((await request(app).get(`/api/tasks/${task.id}/attachments`).set(auth(member))).body.attachments).toHaveLength(1);
    const downloaded = await request(app).get(`/api/attachments/${uploadedAttachment.id}/download`).set(auth(member));
    expect(downloaded.status).toBe(200);
    expect(downloaded.body.toString('utf8')).toBe('temporary attachment content');
    expect((await request(app).delete(`/api/attachments/${uploadedAttachment.id}`).set(auth(member))).status).toBe(200);
    uploadedAttachment = null;

    const invite = await request(app).post(`/api/projects/${project.id}/invitations`).set(auth(manager)).send({ email: outsider.user.email });
    expect(invite.status).toBe(201);
    const inviteToken = new URL(invite.body.invitation_url).searchParams.get('token');
    expect((await request(app).post('/api/projects/invitations/accept').set(auth(outsider)).send({ token: inviteToken })).status).toBe(200);
    expect((await request(app).get(`/api/projects/${project.id}/tasks`).set(auth(outsider))).status).toBe(200);

    const progress = await request(app).get('/api/dashboard/progress').set(auth(member));
    expect(progress.status).toBe(200);
    expect(progress.body.progress.map(item => item.id)).toContain(project.id);
    expect(progress.body.progress.map(item => item.id)).not.toContain(otherProject.id);
    expect((await request(app).get('/api/dashboard/upcoming').set(auth(member))).status).toBe(200);
    expect((await request(app).get('/api/dashboard/statistics').set(auth(member))).status).toBe(200);
    expect((await request(app).get('/api/audit-logs').set(auth(manager))).status).toBe(403);
    expect((await request(app).get('/api/audit-logs').set(auth(admin))).status).toBe(200);
    expect((await request(app).get('/api/users').set(auth(admin))).status).toBe(200);
    expect((await request(app).patch(`/api/users/${outsider.user.id}/role`).set(auth(admin)).send({ role: 'manager' })).status).toBe(200);
    expect((await request(app).patch(`/api/users/${outsider.user.id}/role`).set(auth(admin)).send({ role: 'member' })).status).toBe(200);

    expect((await request(app).patch(`/api/projects/${project.id}/manager`).set(auth(admin)).send({ manager_id: secondManager.user.id })).status).toBe(200);
    expect((await request(app).put(`/api/projects/${project.id}`).set(auth(manager)).send({ title: 'No longer manager' })).status).toBe(403);
    expect((await request(app).get(`/api/projects/${project.id}`).set(auth(secondManager))).status).toBe(200);

    expect((await request(app).delete(`/api/tasks/${task.id}`).set(auth(secondManager))).status).toBe(200);
    expect((await request(app).delete(`/api/projects/${project.id}`).set(auth(secondManager))).status).toBe(200);
    expect((await request(app).delete(`/api/projects/${otherProject.id}`).set(auth(secondManager))).status).toBe(200);
    project = null;
    otherProject = null;
    task = null;
  });

  it('returns generic password recovery responses for unknown accounts', async () => {
    const response = await request(app).post('/api/auth/forgot-password').send({ email: `missing-${suffix}@example.invalid` });
    expect(response.status).toBe(200);
    expect(response.body.development_token).toBeUndefined();
  });

  it('consumes password reset tokens once and accepts the new password', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await app.locals.database.query("INSERT INTO password_reset_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')", [member.user.id,hash]);
    const changed = await request(app).post('/api/auth/reset-password').send({ token: rawToken, password: `Reset-${suffix}-Pass9` });
    expect(changed.status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({ token: rawToken, password: `Reset-${suffix}-Pass9` })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: member.user.email, password: `Reset-${suffix}-Pass9` })).status).toBe(200);
  });
});
