# Slides Voice Bot

Upload any PDF, parse slide text at runtime, and present it through a session-specific VAPI assistant.

## What This Version Focuses On

- Text-only slide extraction and rendering.
- Text-only context sent to VAPI (no image OCR, no GraphicsMagick, no ImageMagick).
- Runtime processing: each uploaded PDF creates a fresh presentation session.

## Flow Overview

1. User uploads a PDF on `/`.
2. `POST /api/process-pdf` extracts text per page with `pdfjs-dist`.
3. Session is stored in-memory with 2-hour TTL.
4. Server creates a VAPI assistant with slide summaries and a `navigate_to_slide` tool.
5. User is redirected to `/present?session=...`.
6. Slide changes from VAPI tool calls are streamed to the UI via SSE.

## API Routes

- `POST /api/process-pdf`
- `GET /api/slides/[sessionId]`
- `GET /api/slides/stream?session=<sessionId>`
- `POST /api/vapi/create-assistant`
- `POST /api/vapi/tool-call`

## Environment Variables

Create `.env.local`:

```env
VAPI_API_KEY=
NEXT_PUBLIC_VAPI_PUBLIC_KEY=
GROQ_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Notes:

- `GROQ_API_KEY` is configured in VAPI assistant settings and not called directly by this app.
- If `VAPI_API_KEY` is missing, PDF sessions still work but voice assistant creation is skipped.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## VAPI Webhook Reachability

VAPI must reach `/api/vapi/tool-call` over the public internet.

- Local dev: expose localhost with `ngrok` or `localtunnel` and set `NEXT_PUBLIC_APP_URL` to that public URL.
- Production: deploy to Vercel and set `NEXT_PUBLIC_APP_URL` to your Vercel domain.

## Deployment Notes

- No native image conversion dependencies are required.
- Session state is in-memory, which is fine for a demo.
- In serverless environments, memory is per instance. For production-grade persistence, move sessions to Redis or a database.
