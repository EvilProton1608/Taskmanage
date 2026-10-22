# TaskManage API

Base URL: `http://localhost:5000/api`. Send `Authorization: Bearer <token>` to protected endpoints. IDs are UUIDs. JSON errors use `{ "error": "..." }`. List endpoints accept `page` (default 1) and `limit` (default 25, maximum 100); project/task lists also support `search`.

## Authentication

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public | Create a member account; public registration cannot select a role |
| POST | `/auth/login` | Public, rate limited | Return user and 7-day bearer token |
| GET | `/auth/me` | Signed in | Return the current account and current role |
| POST | `/auth/forgot-password` | Public, rate limited | Send a one-hour reset token by configured email service |
| POST | `/auth/reset-password` | Public | Consume `{token,password}` once |

Password reset email delivery uses `RESEND_API_KEY` and `EMAIL_FROM`. In non-production mode without email credentials, the API returns a development-only token for local testing. Unknown email addresses receive the same response as known addresses.

## Users and audit

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/users?page=1&limit=25` | Admin | List users |
| PATCH | `/users/:id/role` | Admin | Set role to `admin`, `manager`, or `member` |
| DELETE | `/users/:id` | Admin | Delete another user account |
| GET | `/audit-logs?page=1&limit=25` | Admin | Read recent audit activity |

## Projects and teams

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/projects?search=&status=&page=1&limit=25` | Signed in | List visible projects; status: `active`, `on_hold`, `completed`, `archived` |
| POST | `/projects` | Admin/manager | Create a project; managers own it, admins can select a manager |
| GET | `/projects/:id` | Project member | Get project details |
| PUT | `/projects/:id` | Project manager/admin | Update title, description, deadline, status; send `null` to clear optional values |
| DELETE | `/projects/:id` | Project manager/admin | Delete a project and dependent tasks |
| PATCH | `/projects/:id/manager` | Admin | Change the project owner with `{ "manager_id": "uuid" }` |
| GET | `/projects/:projectId/members` | Project member | List team members |
| POST | `/projects/:projectId/members` | Project manager/admin | Add an existing account with `{ "email": "...", "project_role": "member" }` |
| DELETE | `/projects/:projectId/members/:userId` | Project manager/admin | Remove a member |
| POST | `/projects/:projectId/invitations` | Project manager/admin | Create an email invitation and return a shareable invitation URL if email is not configured |
| POST | `/projects/invitations/accept` | Signed in | Accept `{ "token": "..." }` for the signed-in email address |

## Tasks, comments, files

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/projects/:projectId/tasks?status=&priority=&search=&sort=due_date&page=1&limit=25` | Project member | Filter and list tasks; sort is `created_at` (default), `due_date`, `priority`, or `title` |
| POST | `/tasks` | Project member | Create task with title, project ID, optional assignee/description/priority/status/due date |
| PUT | `/tasks/:id` | Project manager/admin; assigned member | Update task; `null` clears assignee or due date |
| DELETE | `/tasks/:id` | Project manager/admin | Delete task and dependent comments/files/history |
| GET | `/tasks/:taskId/history` | Project member | Read status transitions |
| GET | `/tasks/:taskId/comments` | Project member | List comments |
| POST | `/tasks/:taskId/comments` | Project member | Add `{ "content": "..." }` |
| GET | `/tasks/:taskId/attachments` | Project member | List file metadata |
| POST | `/tasks/:taskId/attachments` | Project member | Upload `{ "file_name", "mime_type", "data" }` where `data` is base64; max 5 MB |
| GET | `/attachments/:id/download` | Project member | Download attachment |
| DELETE | `/attachments/:id` | Uploader/project manager/admin | Delete file and metadata |

## Dashboard and health

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/health` | Public | Check API and database connectivity |
| GET | `/dashboard/progress` | Signed in | Counts by visible project and task status |
| GET | `/dashboard/upcoming` | Signed in | Up to 10 upcoming or overdue tasks in visible projects |
| GET | `/dashboard/statistics` | Signed in | Visible-task totals and team performance |

## Example

```sh
curl -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"member@example.com","password":"your-password"}'

curl http://localhost:5000/api/projects \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Import `../postman/TaskManage.postman_collection.json` for ready-to-run requests.
