# Bubba 🫂

**"I'm not going anywhere."**

Bubba is a WhatsApp companion for NDU Law Faculty students. Not a therapist. Not a chatbot. A real presence you can text when everything is falling apart.

Built with [Baileys](https://github.com/WhiskeySockets/Baileys) + [Supabase](https://supabase.com) + [Claude](https://anthropic.com).

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- A Supabase project (free tier works)
- An Anthropic API key
- A phone number dedicated to Bubba (separate from your personal number)

### 2. Setup

```bash
# Clone the repo
git clone https://github.com/itztonydoubra-hash/the-main-bubba.git
cd the-main-bubba

# Install dependencies
npm install

# Copy env file and fill in your keys
cp .env.example .env
```

### 3. Supabase Database

1. Go to your Supabase project → SQL Editor
2. Paste the contents of `src/db/schema.sql` and run it
3. Copy your project URL and **service role key** (not anon key) into `.env`

### 4. Run Bubba

```bash
npm start
```

A QR code will appear in your terminal. Scan it with the WhatsApp account you want Bubba to use. Once connected, Bubba is live.

---

## Architecture

```
WhatsApp (Baileys)
    ↓ incoming message
Main Orchestrator (src/index.js)
    ├── Crisis Detector (pattern matching)
    ├── Supabase (conversation history + user memory)
    ├── Claude API (generates Bubba's response)
    └── Check-in Scheduler (proactive follow-ups)
    ↓ response
WhatsApp (Baileys)
```

## Project Structure

```
src/
├── index.js              # Main orchestrator
├── ai/
│   └── claude.js         # Anthropic/Claude integration
├── checkins/
│   └── scheduler.js      # Proactive check-in system
├── crisis/
│   └── detector.js       # Crisis pattern detection
├── db/
│   ├── schema.sql        # Supabase table definitions
│   └── supabase.js       # Database client & queries
├── prompts/
│   └── system.js         # Bubba's system prompt (her soul)
└── whatsapp/
    └── connection.js     # Baileys WhatsApp connection
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (full access) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `CHECK_IN_ENABLED` | `true` to enable proactive check-ins |
| `CHECK_IN_CRON` | Cron expression for check-in schedule (default: `0 10 * * *`) |

## Key Features

- **Real conversation** — Claude Sonnet with a deeply detailed system prompt that makes Bubba feel like a real person
- **Memory** — Supabase stores conversation history so Bubba remembers you
- **Crisis detection** — Pattern matching in English and Nigerian Pidgin catches danger signals
- **Proactive check-ins** — Bubba notices when you go quiet and reaches out
- **Privacy** — All data tied to phone number, deletable on request
- **Right to forget** — Text "delete everything" and all your data is wiped

## Important Notes

- Bubba uses a **service role key** for Supabase (not the anon key) because the bot itself manages all user data server-side
- The `auth_info/` folder stores WhatsApp session credentials — keep it secure and never commit it
- Crisis detection runs alongside normal responses — it doesn't block conversation, it adds awareness

---

*Built with love for NDU Law Faculty. Because nobody should have to struggle alone.*
