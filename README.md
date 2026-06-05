This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Database (Neon + Drizzle)

Critiq uses Neon Postgres via Drizzle ORM. Schema lives in `src/db/schema.ts`; the
lazy connection handle is `src/db/index.ts` (never opens a connection at import time).

### Environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection (app runtime; host contains `-pooler`) |
| `DATABASE_URL_UNPOOLED` | Neon **direct** connection (migrations / DDL) |
| `AUTH_SECRET` | NextAuth v5 signing secret (Phase 3) |
| `RESEND_API_KEY` / `AUTH_RESEND_KEY` | Email + magic links (Phase 3) |
| `ANTHROPIC_API_KEY` | LLM scoring/coaching (Phase 15+) |
| `DEEPGRAM_API_KEY` | Transcription (Phase 15+) |

Local values go in `.env.local` (gitignored). Deployed values must be set in the
Vercel project env for **all** environments (preview, production, development).

### Migrations

```bash
pnpm db:generate   # generate SQL from schema.ts into ./drizzle
pnpm db:migrate    # apply pending SQL to the DB (direct SQL; tracks _critiq_migrations)
```

**Never run `drizzle-kit push`** (it needs a TTY). Migrations are applied via
`scripts/migrate.ts`. Routes that read/write the DB must set
`export const dynamic = "force-dynamic"`.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
