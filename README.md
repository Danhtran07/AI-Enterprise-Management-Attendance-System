<div align="center">

# Averis

### AI-Powered Enterprise Attendance Management System

<p>
  <b>Facial Recognition</b> •
  <b>Attendance</b> •
  <b>Employee Management</b> •
  <b>AI Verification</b>
</p>

<p>
  <img src="https://img.shields.io/badge/React-TypeScript-61DAFB?style=for-the-badge&logo=react&logoColor=black">
  <img src="https://img.shields.io/badge/FastAPI-Python-009688?style=for-the-badge&logo=fastapi&logoColor=white">
  <img src="https://img.shields.io/badge/PostgreSQL-Database-4169E1?style=for-the-badge&logo=postgresql&logoColor=white">
  <img src="https://img.shields.io/badge/AI-InsightFace-FF6B35?style=for-the-badge">
  <img src="https://img.shields.io/badge/Docker-Containerized-2496ED?style=for-the-badge&logo=docker&logoColor=white">
</p>

<p>
  A modern attendance management system using
  <b>facial recognition and AI-based verification</b>
  to automate employee check-in and check-out.
  <br>
  <b>Built for secure, automated, and intelligent workforce management.</b>
</p>

</div>

---

## Overview

**Averis** is an intelligent AI-powered attendance management system
that combines **facial recognition, employee verification,
attendance tracking, and AI processing**.

This repository showcases how a full-stack AI application can be structured using a React frontend, FastAPI backend, PostgreSQL database, and a dedicated AI recognition service.

### Core Features

| Feature | Description |
|---|---|
| Face Recognition | Identify employees using facial embeddings |
| Check-in / Check-out | Automate attendance recording |
| Employee Verification | Verify employee identity |
| Attendance Tracking | Store and manage attendance records |
| AI Processing | Face detection, alignment, embedding and matching |
| Admin Management | Manage employees and attendance |
| REST API | API-first backend architecture |
| Docker | Containerized development environment |

---

## Architecture

```text
                    ┌─────────────────────┐
                    │      Frontend       │
                    │ React + TypeScript  │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │       Backend       │
                    │ FastAPI + SQLAlchemy│
                    └───────┬───────┬─────┘
                            │       │
                  ┌─────────┘       └─────────┐
                  ▼                           ▼
        ┌─────────────────┐          ┌─────────────────┐
        │   PostgreSQL    │          │   AI Service    │
        │    Database     │          │ FastAPI + AI    │
        └─────────────────┘          └────────┬────────┘
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │   InsightFace   │
                                     │ Face Recognition│
                                     └─────────────────┘
```

---

## Project Structure

This project is built as a monorepo and includes three main modules:

- `apps/backend/` — REST API, authentication, attendance logic, and database integration
- `apps/ai-service/` — AI processing service for face analysis and recognition
- `apps/frontend/` — web application for employees and administrators

The main goal is to provide a secure, modern attendance workflow with:

- face-based recognition
- employee verification
- attendance tracking
- API-first backend architecture
- containerized local development using Docker

## Tech Stack

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS

### Backend
- Python
- FastAPI
- SQLAlchemy
- Alembic
- JWT authentication

### AI Service
- Python
- FastAPI
- InsightFace / face processing pipeline
- Embedding-based recognition flow

### Database
- PostgreSQL

### DevOps / Local Setup
- Docker
- Docker Compose

```text
.
├── apps/
│   ├── backend/
│   ├── ai-service/
│   └── frontend/
├── docker-compose.yml
├── .env.example
├── README.md
└── LICENSE
```

> Note: This is a demo and learning project, not a production-ready enterprise deployment.

## AI Service Source References

This project uses the face biometrics workflow and learning approach from the following open-source reference:

- [amoghgg/face-biometrics-api](https://github.com/amoghgg/face-biometrics-api) — Face biometrics API with active liveness detection (head turns + smile), face recognition (1:1 verify + 1:N search), age, gender and emotion analysis. Built with FastAPI + MediaPipe + InsightFace ArcFace.

### What we used as reference

- Face detection and liveness-check patterns
- Face recognition and verification workflow
- ArcFace-based embedding concepts
- MediaPipe / InsightFace integration ideas for demo and learning purposes

> This project is for educational and demonstration purposes. The AI service is inspired by the referenced repository and adapted to fit our attendance demo scenario, not copied as-is for production use.

## Quick Start for Team Members

Follow the steps below to run the project locally.

### 1) Clone the repository

```bash
git clone <repository-url>
cd intergration
```

### 2) Create environment variables

Copy the example environment file:

```bash
copy .env.example .env
```

Then review the file and adjust values if needed. The default settings are prepared for Docker-based local development.

> Keep your real `.env` file local and do not commit it to Git.

### 3) Start all services with Docker

From the repository root, run:

```bash
docker compose up -d --build
```

This will start:

- PostgreSQL database
- FastAPI backend at http://localhost:8000
- AI service at http://localhost:8002

Check health endpoints:

- Backend: http://localhost:8000/health
- AI service: http://localhost:8002/health

The backend container will automatically run Alembic migrations before starting the app.

### 4) Start the frontend separately

Open a second terminal and run:

```bash
cd apps/frontend
npm install
npm run dev
```

Then open:

- Frontend: http://localhost:5173

The frontend uses Vite and proxies API requests to the backend locally, so no additional API base URL configuration is normally required.

### 5) Useful commands

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f ai-service
docker compose down
```

If port `8000` is already in use, update `BACKEND_PORT` in `.env`. If the AI service port is occupied, update `AI_SERVICE_HOST_PORT` in `.env`.

### 6) JWT secret setup

JWT configuration is backend-only and should never be placed in frontend env files.

Generate a secure secret locally:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Then set it as `JWT_SECRET_KEY` in `.env`.

## Local Development Without Docker

If you want to run services manually instead of using Docker Compose:

### Backend

```bash
cd apps/backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd apps/frontend
npm install
npm run dev
```

### AI service

```bash
cd apps/ai-service/backend
pip install -r ../requirements.txt
uvicorn main:app --reload --port 8001
```

The Docker setup exposes the AI service on port `8002` by default. If that port is in use, change `AI_SERVICE_HOST_PORT` in `.env`.

## Environment Notes

- `.env.example` is the shared template
- `.env` is local-only and should not be committed
- PostgreSQL credentials and JWT secret must remain in backend configuration
- Do not change internal Docker references like `POSTGRES_HOST=postgres` or `DATABASE_URL` unless you know the system is intentionally being modified

## Current Status

The project includes AI-powered face recognition workflows and attendance logic across backend and AI service components. The repo is designed to support iterative development by multiple team members in parallel.

- AI-01 → AI-07 are implemented on `feature/khoa-ai`.
- AI-08 testing report: see [`apps/ai-service/AI_TEST_REPORT.md`](apps/ai-service/AI_TEST_REPORT.md).

AI-01 Face Detection is implemented in `ai-service`.

AI-02 Face Alignment is implemented as a shared `FaceAlignmentService`:

```
Detected Face
      ↓
Facial Landmarks (InsightFace / SCRFD, 5-point)
      ↓
Alignment (ArcFace 112x112)
      ↓
Aligned Face
```

Enrollment and Recognition reuse this same alignment service. The AI service does not access the database.

AI-03 Face Embedding is implemented as `FaceEmbeddingService`:

```
Aligned Face (112x112)
      ↓
ArcFace (InsightFace buffalo_l recognition model)
      ↓
Embedding (float32, L2-normalized)
```

- **Model:** pretrained InsightFace ArcFace. No custom training. No random or fake vectors.
- **Dimension:** taken from the recognition model; buffalo_l uses **512**.
- **dtype:** `float32`.
- **Normalization:** L2 so cosine similarity is a dot product. The same aligned-face preprocessing is used for enrollment and recognition.
- **Backend responsibility:** AI Service only returns `{ "embedding": [...] }`. Backend stores the vector in the database. AI Service does not import SQLAlchemy, PostgreSQL, or backend ORM models.

AI-04 Face Matching is implemented as `FaceMatchingService`:

```
Query Embedding
      ↓
Compare Candidates (from Backend)
      ↓
Cosine Similarity
      ↓
Best Match
      ↓
Threshold (FACE_MATCH_THRESHOLD)
      ↓
Employee ID / Unknown
```

- **No database access:** Backend loads embeddings from PostgreSQL and sends `candidates` to AI Service (`POST /face/match` or via `/face/recognize`).
- **Metric:** Cosine similarity on L2-normalized vectors.
- **Threshold:** configurable via `FACE_MATCH_THRESHOLD` (default `0.5`). Below threshold → `recognized=false`, `employee_id=null`, or `UNKNOWN_FACE`.
- **Output:** `{ "recognized": true/false, "employee_id": ..., "confidence": ... }`

AI-05 Recognition API:

```http
POST /face/recognize
```

**Flow**

```
Image
 ↓
Validate Image
 ↓
Face Detection
 ↓
Check Face Count (0 → NO_FACE, >1 → MULTIPLE_FACES, 1 → continue)
 ↓
Face Alignment
 ↓
Face Embedding
 ↓
Face Matching (candidates from Backend)
 ↓
Result
```

**Request**

```json
{
  "image": "<base64>",
  "candidates": [
    { "employee_id": 123, "embedding": [/* 512 floats */] }
  ],
  "threshold": 0.5
}
```

Backend loads embeddings from PostgreSQL and sends them as `candidates`. AI Service does not open a database connection.

**Recognized response**

```json
{
  "recognized": true,
  "employee_id": 123,
  "confidence": 0.92
}
```

**Unknown response** (HTTP 404)

```json
{
  "success": false,
  "error_code": "UNKNOWN_FACE",
  "message": "No matching employee",
  "details": {
    "recognized": false,
    "employee_id": null,
    "confidence": 0.31
  }
}
```

**Error cases:** `NO_FACE`, `MULTIPLE_FACES`, `UNKNOWN_FACE`, `INVALID_IMAGE`, `INVALID_EMBEDDING`, `MODEL_ERROR`

**Backend integration:** Backend authenticates the request, fetches enrolled embeddings, calls AI `/face/recognize`, then records attendance when `recognized=true`.

AI-06 Enrollment Processing:

```http
POST /face/enroll
```

**Flow**

```
Employee
   ↓
Image
   ↓
Detection
   ↓
Exactly One Face
   ↓
Alignment
   ↓
Embedding
   ↓
Return Embedding
   ↓
Backend → PostgreSQL
```

**Request**

```json
{
  "image": "<base64>"
}
```

**Success**

```json
{
  "success": true,
  "embedding": [/* float32 vector, typically 512-dim */]
}
```

**Failure**

```json
{
  "success": false,
  "error_code": "NO_FACE",
  "message": "No face detected",
  "details": null
}
```

- Uses the **same** Detector, Alignment, Embedding model, and preprocessing as Recognition.
- Exactly one face required (`0 → NO_FACE`, `>1 → MULTIPLE_FACES`).
- AI Service does **not** create/update employees or write to the database.
- **Backend responsibility:** persist the returned embedding in PostgreSQL and link it to the employee record.

AI-07 AI Error Handling:

Centralized FastAPI exception handling (`app/core/errors.py`) returns a uniform payload for `/face/enroll`, `/face/recognize`, and other AI routes:

```json
{
  "success": false,
  "error_code": "NO_FACE",
  "message": "No face detected",
  "details": null
}
```

| Error | Meaning |
| ----- | ------- |
| NO_FACE | No face detected |
| MULTIPLE_FACES | Multiple faces detected |
| UNKNOWN_FACE | No matching employee |
| INVALID_IMAGE | Invalid image |
| LOW_QUALITY | Poor face quality |
| MODEL_ERROR | Model inference error |
| INVALID_EMBEDDING | Invalid embedding |
| INVALID_REQUEST | Invalid request |

Responses never include stack traces, raw images, full embeddings, secrets, JWT, or database connection details. Server logs keep request path/method and error code for debugging without logging sensitive payloads.

The backend integration includes authentication, users, employees, attendance,
database migrations, and health endpoints.

## License

This project is released under the project license included in the repository.
