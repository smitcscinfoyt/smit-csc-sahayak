# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### Smit CSC Info (react-vite)
- **Path**: `artifacts/smit-csc-info/`
- **Preview**: `/` (root)
- **Purpose**: "Smit CSC Info" — Digital India e-Services website with Smit AI Sahayak floating chat widget
- **Theme**: Deep Purple (#2e004f) + Golden (#ffd700), glassmorphism

### API Server (express)
- **Path**: `artifacts/api-server/`
- **Purpose**: Backend Express API. Provides:
  - `GET /api/healthz` — health check
  - `POST /api/chat` — Gemini AI chat with RAG from `knowledge.txt`

## AI Integration

- **Model**: `gemini-2.0-flash-lite` via `@google/generative-ai`
- **API Key**: `GEMINI_API_KEY` environment secret
- **Knowledge file**: `knowledge.txt` (root) — loaded on every request for RAG
- **Language**: Strictly Gujarati responses
- **System identity**: "Smit AI Sahayak"

## Features

- Floating chat widget (bottom-right)
- Glassmorphism chat window
- Voice-to-Text (Web Speech API, Gujarati `gu-IN`)
- Auto-scroll on new messages
- Bullet-point formatted Gujarati responses
- Quick-reply suggestion chips
- CSC services knowledge base in `knowledge.txt`
