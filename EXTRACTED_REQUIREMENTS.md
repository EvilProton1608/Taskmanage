# Extracted Requirements from question.docx

## Overview
Build a full-stack web application that allows organizations to manage projects, teams, and tasks. The application should support multiple users, role-based access, task tracking, and project collaboration.

## Functional Requirements

### User Authentication
- **User Registration & Login**
  - Create new user accounts
  - Implement secure login system
  - Support password recovery/reset

- **JWT Authentication**
  - Implement JSON Web Token (JWT) based authentication
  - Secure token storage and validation

- **Role-Based Access (Admin, Project Manager, Team Member)**
  - Define user roles with different permissions
  - Implement role-based access control
  - Admin can manage users, projects, and teams
  - Project Manager can create/edit projects and assign tasks
  - Team Member can view/assign tasks within projects

### Project Management
- **Create, Update, Delete Projects**
  - Project CRUD operations
  - Project details storage
  - Project search and filtering

- **Assign Project Managers**
  - Assign users to project manager roles
  - Project manager permissions

- **Add Team Members**
  - Invite and manage team members
  - Team member permissions and roles

- **Set Project Deadlines**
  - Project timeline management
  - Deadline notifications

### Task Management
- **Create, Assign, Edit, Delete Tasks**
  - Full task CRUD operations
  - Task assignment functionality

- **Task Priority (Low, Medium, High)**
  - Implement priority levels
  - Priority-based sorting and filtering

- **Task Status (To Do, In Progress, Completed)**
  - Task workflow management
  - Status transition tracking

- **Due Dates**
  - Individual task deadlines
  - Overdue task detection

- **Task Comments**
  - Comment system for tasks
  - Real-time comment updates

- **File Attachments Dashboard**
  - File upload functionality
  - File management system

### Project Progress & Analytics
- **Project Progress**
  - Track project completion status
  - Visual project progress indicators

- **Task Statistics**
  - Task completion statistics
  - Performance metrics

- **Upcoming Deadlines**
  - Show approaching deadlines
  - Alert system for overdue items

- **Completed vs Pending Tasks**
  - Task status aggregation
  - Progress visualization

- **Team Performance Overview**
  - Individual and team performance metrics
  - Productivity tracking

### Technical Requirements

#### User Interface
- **Responsive UI**
  - Mobile-friendly design
  - Cross-browser compatibility

#### APIs & Architecture
- **RESTful APIs**
  - Create REST endpoints
  - API documentation

#### Security & Validation
- **Input Validation**
  - Client-side and server-side validation
  - Data integrity checks

- **Exception Handling**
  - Robust error handling
  - Graceful failure responses

- **Search, Filter & Pagination**
  - Search functionality
  - Advanced filtering options
  - Data pagination for large datasets

- **Audit Logs**
  - Track user actions
  - System event logging

- **Secure Password Hashing**
  - Implement secure password storage
  - Use industry-standard hashing algorithms

- **API Documentation**
  - Complete API documentation
  - Postman collection

#### Quality Assurance
- **Unit Testing**
  - Comprehensive unit tests
  - Test coverage requirements

- **Docker Support**
  - Containerize the application
  - Docker compose setup

#### Deliverables

### Documentation & Resources
- **GitHub Repository**
  - Source code repository
  - Version control

- **Source Code**
  - Complete source code
  - Code documentation

- **Database Schema**
  - Database structure documentation
  - ER diagram

- **ER Diagram**
  - Entity Relationship Diagram
  - Database design documentation

- **API Documentation**
  - Complete API documentation
  - Usage examples

- **Postman Collection**
  - API testing collection
  - Request examples

- **README**
  - Project documentation
  - Setup and usage instructions

- **Deployment Link**
  - Live application URL
  - Deployment instructions

## Implemented project stack and setup

The implementation in this repository uses Node.js 20+, Express, React, and PostgreSQL (including Supabase). Run `npm ci` in the repository root and `client`, configure `DATABASE_URL` and `JWT_SECRET`, then apply the ordered SQL migrations with `npm run migrate`. See `README.md` for full local and Docker setup.

## Requirement delivery status

The source includes registration/login, database-backed role enforcement, account administration, token-based password recovery, project/team CRUD and invitations, tasks and assignments, priority/status/due dates, comments, attachments, status history, scoped dashboards, validation, filtering/pagination, audit logs, Postman requests, API documentation, ER diagram, tests, and Docker support.

The live deployment URL is an external deliverable and remains unset until a hosting account/domain and production secrets are configured. Email sending requires a Resend API key and sender address. The first admin is bootstrapped through the database console after registering an account.
