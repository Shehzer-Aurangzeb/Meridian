# Meridian

AI-powered crypto trading analysis assistant. Analyzes live market data and suggests trades based on technical indicators.

## Features

- **Live Market Data** - Fetches real-time candles and prices from Binance
- **Technical Analysis** - RSI, Bollinger Bands, ATR, Support/Resistance
- **AI-Powered Suggestions** - Claude API analyzes data and recommends trades
- **Trade Logging** - All analyses saved to PostgreSQL database

## Tech Stack

- **Backend**: NestJS (TypeScript)
- **Frontend**: Next.js (TypeScript, Tailwind CSS)
- **Database**: PostgreSQL + Prisma ORM
- **AI**: Claude API (Anthropic)
- **Data**: Binance API

## Setup

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp apps/api/.env.example apps/api/.env.local
# Edit .env.local with your credentials

# Start PostgreSQL (Docker)
docker run -d --name meridian-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=meridian_db \
  -p 5433:5432 postgres:16-alpine

# Run database migrations
cd apps/api && npx prisma migrate dev

# Start development servers
pnpm dev
```

## Environment Variables

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/meridian_db
ANTHROPIC_API_KEY=your_api_key_here
```

## API Usage

```bash
POST /analysis/analyze
Content-Type: application/json

{
  "coin": "BTC",
  "timeframe": "4h"  // optional: 1h, 4h, 12h, 1d
}
```

## Project Structure

```
apps/
├── api/     # NestJS backend (port 3001)
└── web/     # Next.js frontend (port 3000)
packages/
└── shared/  # Shared TypeScript types
```

## A note on `docs/`

Design notes, research logs and reference material live in `docs/`, which is
not published. Code comments referring to `docs/STATE_OF_PLAY.md` and similar
point at those local working notes — the code stands on its own without them.
