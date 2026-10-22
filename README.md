# TaskManage

TaskManage keeps project details, assigned work, and team discussion in one place. Project managers can organize tasks and invite people to a project. Team members can update their assigned work, comment, and share files. The dashboard summarizes activity for projects the signed-in user can access.

## Features

- **Accounts and roles:** member registration, login, role-based admin/manager/member access, password recovery, and admin account management.
- **Projects and teams:** project CRUD, manager assignment, search/filter/pagination, existing member management, email invitations, and deadlines.
- **Tasks:** task CRUD, assignees, priority/status/due dates, overdue detection, server-side filtering/pagination, comments, status history, and file attachments up to 5 MB.
- **Dashboard:** project progress, scoped task statistics, team performance, and upcoming/overdue deadlines.
- **Operations:** PostgreSQL migrations, audit logs, input validation, access checks, Docker Compose, Postman collection, API guide, and ER diagram.

## Technology

- Node.js 20+, Express 4, PostgreSQL, `pg`, `bcryptjs`, and `jsonwebtoken`
- React 19, React Router, Axios, and nginx
- Jest and Supertest
- Docker Compose

## Local setup

Requirements: Node.js 20+, npm, and a PostgreSQL database. Supabase PostgreSQL works as a hosted database.

1. Install dependencies from the repository root and client directory:

   ```sh
   npm ci
   cd client && npm ci && cd ..
   ```

2. Set environment variables for the API process without committing secrets:

   ```text
   DATABASE_URL=postgresql://...
   JWT_SECRET=<long random secret>
   CLIENT_ORIGIN=http://localhost:3000
   DATABASE_SSL=true
   ```

   A local database can instead use `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Set `DATABASE_SSL=false` for a local PostgreSQL instance.

3. Apply the versioned migrations:

   ```sh
   npm run migrate
   ```

   The migration runner initializes a fresh database from `server/models/schema.sql`, then applies each unapplied SQL file under `server/migrations/`. It detects an existing TaskManage database and applies only new migrations.

4. Start the API and frontend in separate terminals:

   ```sh
   npm start
   ```

   ```sh
   cd client && npm start
   ```

   The API is at `http://localhost:5000`; the React development server is at `http://localhost:3000`.

### First admin account

Public registration always creates a member. After registering the first account, promote it once through the database console:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-admin@example.com';
```

Admins can grant manager/admin roles through the Administration page. The API reloads roles from the database for each request, so users should sign in again after a role change.

### Email and password recovery

Password reset and invitations send email through Resend when `RESEND_API_KEY` and `EMAIL_FROM` are configured. In non-production mode without mail credentials, reset tokens and invitation links are returned for manual testing/sharing. In production, configure email delivery before relying on recovery emails.

### File storage

Uploads are limited to 5 MB and stored under `server/uploads` by default. Set `UPLOAD_DIR` to a persistent mounted directory in hosted environments. The Docker Compose file defines a persistent named volume for uploads.

## Docker Compose

Set `DATABASE_URL` and `JWT_SECRET`, then run migrations once and start the services:

```sh
docker compose run --rm api node server/migrate.js
docker compose up --build -d
```

The frontend is available at port 3000 and the API at port 5000. Compose requires a JWT secret rather than silently using an insecure default. Set `CLIENT_ORIGIN` to the browser-visible frontend URL and `DATABASE_SSL` according to the PostgreSQL provider.

## Tests and build

```sh
npm test -- --runInBand
cd client && npm run build
```

The Jest integration suite uses unique temporary accounts and project data, then cleans them up. A configured database must be reachable. The production build command checks that the React app compiles.

## Documentation

- [API endpoint reference](documentation/API.md)
- [Database ER diagram](documentation/ERD.md)
- [Postman collection](postman/TaskManage.postman_collection.json)
- [Database schema](server/models/schema.sql)
- [Versioned database migrations](server/migrations)
- [Source requirements](EXTRACTED_REQUIREMENTS.md)

## Deployment

The repository includes Dockerfiles and Compose configuration but does not have a live deployment URL yet. To deploy, provision PostgreSQL and persistent file storage, configure the variables above in the host’s secret manager, run migrations, and publish the Compose services. The public deployment URL should be added here after the hosting account/domain is configured.

## Security notes

- Use a unique, high-entropy `JWT_SECRET` and keep it in the deployment secret manager.
- Set `CLIENT_ORIGIN` to the exact frontend origin(s); the default is local development only.
- Do not set `NODE_ENV=production` without configuring an email service if users need password recovery or invitation emails.
- Promote the initial admin through a trusted database console; public sign-up cannot grant elevated roles.
