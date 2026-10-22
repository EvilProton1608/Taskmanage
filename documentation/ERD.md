# Database entity relationship diagram

```mermaid
erDiagram
  USERS ||--o{ PROJECTS : manages
  USERS ||--o{ PROJECT_MEMBERS : joins
  PROJECTS ||--o{ PROJECT_MEMBERS : contains
  PROJECTS ||--o{ PROJECT_INVITATIONS : invites
  USERS ||--o{ PROJECT_INVITATIONS : creates
  PROJECTS ||--o{ TASKS : contains
  USERS o|--o{ TASKS : assigned_to
  USERS ||--o{ TASKS : creates
  TASKS ||--o{ COMMENTS : has
  USERS ||--o{ COMMENTS : writes
  TASKS ||--o{ ATTACHMENTS : has
  USERS ||--o{ ATTACHMENTS : uploads
  TASKS ||--o{ TASK_STATUS_HISTORY : tracks
  USERS o|--o{ TASK_STATUS_HISTORY : changes
  USERS ||--o{ PASSWORD_RESET_TOKENS : requests
  USERS o|--o{ AUDIT_LOGS : performs

  USERS {
    uuid id PK
    string name
    string email UK
    string password_hash
    enum role
  }
  PROJECTS {
    uuid id PK
    string title
    uuid manager_id FK
    date deadline
    enum status
  }
  PROJECT_MEMBERS {
    uuid project_id PK,FK
    uuid user_id PK,FK
    enum project_role
  }
  PROJECT_INVITATIONS {
    uuid id PK
    uuid project_id FK
    string email
    string token_hash
    timestamptz expires_at
  }
  TASKS {
    uuid id PK
    uuid project_id FK
    uuid assignee_id FK
    uuid created_by FK
    enum priority
    enum status
    date due_date
  }
  COMMENTS {
    uuid id PK
    uuid task_id FK
    uuid user_id FK
    text content
  }
  ATTACHMENTS {
    uuid id PK
    uuid task_id FK
    uuid uploaded_by FK
    string file_path
    bigint file_size
  }
  TASK_STATUS_HISTORY {
    uuid id PK
    uuid task_id FK
    uuid changed_by FK
    enum old_status
    enum new_status
  }
  PASSWORD_RESET_TOKENS {
    uuid id PK
    uuid user_id FK
    string token_hash UK
    timestamptz expires_at
    timestamptz used_at
  }
  AUDIT_LOGS {
    uuid id PK
    uuid user_id FK
    string action
    string entity_type
    uuid entity_id
    jsonb details
  }
```

All foreign keys cascade or set null according to the data's ownership. See `server/models/schema.sql` and ordered SQL migrations for the complete PostgreSQL definition.
