-- Tournament Software Database Migration
-- Run this in your Supabase SQL Editor to add the necessary columns for Arena tournaments and detailed player profiles.

-- 1. Update tournaments table (Arena Settings)
ALTER TABLE tournaments
ADD COLUMN IF NOT EXISTS arena_duration INTEGER,
ADD COLUMN IF NOT EXISTS arena_start_time TIMESTAMP,
ADD COLUMN IF NOT EXISTS arena_scoring_config JSONB,
ADD COLUMN IF NOT EXISTS arena_end_strategy TEXT DEFAULT 'wait_for_ongoing' NOT NULL,
ADD COLUMN IF NOT EXISTS arena_pairing_mode TEXT DEFAULT 'manual' NOT NULL,
ADD COLUMN IF NOT EXISTS arena_cutoff_minutes INTEGER DEFAULT 2 NOT NULL,
ADD COLUMN IF NOT EXISTS arena_countdown_seconds INTEGER DEFAULT 10 NOT NULL,
ADD COLUMN IF NOT EXISTS arena_pre_pair_before_start BOOLEAN DEFAULT false NOT NULL;

-- 2. Update players table (Arena Stats & Detailed Profile)
ALTER TABLE players
-- Arena Columns
ADD COLUMN IF NOT EXISTS arena_status TEXT DEFAULT 'lobby' NOT NULL,
ADD COLUMN IF NOT EXISTS arena_points NUMERIC(10, 2) DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS arena_streak INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS on_fire BOOLEAN DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS last_opponent_id INTEGER,
ADD COLUMN IF NOT EXISTS color_delta INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS consecutive_color TEXT,
-- Profile Details
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' NOT NULL,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS club TEXT,
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS birthdate TEXT,
ADD COLUMN IF NOT EXISTS sex TEXT,
ADD COLUMN IF NOT EXISTS local_id TEXT,
ADD COLUMN IF NOT EXISTS rating_local INTEGER,
ADD COLUMN IF NOT EXISTS rating_rapid INTEGER,
ADD COLUMN IF NOT EXISTS rating_blitz INTEGER;

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_players_tournament_arena_status ON players(tournament_id, arena_status);
CREATE INDEX IF NOT EXISTS idx_players_tournament_arena_points ON players(tournament_id, arena_points DESC);
CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);
CREATE INDEX IF NOT EXISTS idx_players_local_id ON players(local_id);
