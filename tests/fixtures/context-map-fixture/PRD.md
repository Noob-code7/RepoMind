# Enterprise Task & Auth Platform

## Goals
- Allow users to authenticate securely with JWT tokens.
- Manage task creation, retrieval, and completion via TaskController and TaskService.
- Send email notifications after task creation or completion.

## Requirements
### REQ-001: Task Management & Creation
Users must be able to create tasks with validated titles.

### REQ-002: Authentication & Token Validation
Only authenticated users can create and complete tasks. System validates bearer tokens.

### REQ-003: Input Validation
Task creation must be validated strictly against schema rules.

### REQ-004: Email Notification
Send email notifications after task creation.

### REQ-005: High Performance Scaling
System should be fast and scale gracefully under load etc.
