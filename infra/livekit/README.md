# Self-hosted LiveKit

This project uses LiveKit only as the real-time WebRTC engine. The Course CRM keeps authentication, course access and meeting metadata in its existing Express + Supabase stack.

For local development, run a LiveKit server in dev mode (`livekit-server --dev`). For production, use the official self-hosted deployment flow with Docker/Compose, a real domain, TLS, and TURN. Do not put `LIVEKIT_API_SECRET` in the React/Vite environment.

Required backend variables:

```env
LIVEKIT_WS_URL=wss://livekit.yourdomain.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

Production networking normally needs HTTPS/WSS plus the LiveKit WebRTC/TURN ports. See the official LiveKit self-hosting documentation before deploying.

## Recording live meetings (optional)

```
Live Meeting -> meeting ends -> LiveKit Egress records the room
-> recording saved to Storage -> Admin Panel > Meetings > [Preview] [Publish]
-> shows up as a normal Video in Course Content -> student watches it
   in the normal video player
```

This is entirely optional — meetings work fine without it. When
enabled, starting a meeting also starts a LiveKit **Room Composite
Egress** that records the whole room and uploads the MP4 directly into
this project's own private Supabase Storage bucket, using Supabase's
S3-compatible endpoint. Because it writes to the exact path a published
course video would use, "publishing" a recording is just the normal
content-publish action — no separate copy step, no new bucket to secure.

To enable it in production:

1. **Give LiveKit an Egress service.** `docker-compose.dev.yml`'s
   `--dev` mode has no Egress and no webhook config, so recording is a
   no-op there. Use `docker-compose.prod.example.yml`,
   `livekit.yaml.example`, and `egress.yaml.example` in this folder as
   a starting point for a real deployment.
2. **Point LiveKit's webhook at the backend.** `livekit.yaml.example`'s
   `webhook.urls` entry should be
   `https://your-backend-domain/api/livekit/webhook` — this is how the
   backend learns a recording finished (see
   `backend/src/routes/livekitWebhook.routes.js`). The webhook is
   signed with the same `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` already
   used for the API, so there's nothing extra to share/rotate.
3. **Enable Supabase's S3-compatible Storage endpoint** (Supabase
   dashboard > Project Settings > Storage > S3 Connection) and set the
   `SUPABASE_S3_*` variables in `backend/.env` (see
   `backend/.env.example`). Leaving any of them unset disables
   recording — meetings still start/end normally.

Once configured, an admin sees a "Recording…" badge on a live meeting,
then "Processing recording…" after it ends, then "Recording ready" with
Preview/Publish buttons on the Meetings screen once LiveKit's webhook
confirms the upload.
