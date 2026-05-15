-- Bubba Supabase Schema
-- Run this in your Supabase SQL editor to set up the database

-- Users table: stores user profiles and preferences
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT UNIQUE NOT NULL,
  display_name TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  context JSONB DEFAULT '{}'::jsonb,  -- stores learned info: family, academics, relationships, etc.
  crisis_consent BOOLEAN DEFAULT FALSE,  -- consent to reach out to emergency contact
  emergency_contact TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table: full conversation history
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crisis logs: records when crisis patterns are detected
CREATE TABLE IF NOT EXISTS crisis_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  trigger_message TEXT NOT NULL,
  detected_patterns TEXT[] DEFAULT '{}',
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  response_given TEXT,
  escalated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Check-in schedule: tracks proactive check-ins
CREATE TABLE IF NOT EXISTS checkin_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  reason TEXT,  -- why we're checking in (exam season, went quiet, after crisis, etc.)
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Goals table: tracks what people are working toward
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  title TEXT NOT NULL,  -- e.g. "Study Evidence Law", "Send CV to 3 firms"
  category TEXT CHECK (category IN ('academic', 'life', 'financial', 'personal_growth')),
  description TEXT,  -- optional extra context
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'dropped')),
  deadline TIMESTAMPTZ,  -- optional deadline
  frequency TEXT CHECK (frequency IN ('once', 'daily', 'weekly', 'custom')),  -- how often
  progress_notes JSONB DEFAULT '[]'::jsonb,  -- array of {date, note, outcome}
  patterns JSONB DEFAULT '{}'::jsonb,  -- learned patterns: avoidance triggers, best times, etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Goal check-ins: individual accountability moments
CREATE TABLE IF NOT EXISTS goal_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  checkin_type TEXT CHECK (checkin_type IN ('morning', 'evening', 'deadline', 'proactive', 'user_initiated')),
  outcome TEXT CHECK (outcome IN ('done', 'partial', 'skipped', 'struggled', 'forgot')),
  note TEXT,  -- what they said about it
  emotional_context TEXT,  -- what was going on emotionally
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wins table: celebrates progress (tiny and big)
CREATE TABLE IF NOT EXISTS wins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  description TEXT NOT NULL,  -- what they accomplished
  category TEXT CHECK (category IN ('academic', 'life', 'financial', 'personal_growth')),
  goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,  -- optional link to a goal
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone_number);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_crisis_logs_user ON crisis_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_checkin_schedule_pending ON checkin_schedule(scheduled_for) WHERE sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_phone ON goals(phone_number);
CREATE INDEX IF NOT EXISTS idx_goals_active ON goals(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_goal_checkins_goal ON goal_checkins(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_checkins_user ON goal_checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_wins_user ON wins(user_id);

-- Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crisis_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE wins ENABLE ROW LEVEL SECURITY;

-- Service role can access everything (the bot uses service role key)
CREATE POLICY "Service role full access" ON users FOR ALL USING (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true);
CREATE POLICY "Service role full access" ON crisis_logs FOR ALL USING (true);
CREATE POLICY "Service role full access" ON checkin_schedule FOR ALL USING (true);
CREATE POLICY "Service role full access" ON goals FOR ALL USING (true);
CREATE POLICY "Service role full access" ON goal_checkins FOR ALL USING (true);
CREATE POLICY "Service role full access" ON wins FOR ALL USING (true);
