import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Get or create a user by phone number
 */
export async function getOrCreateUser(phoneNumber) {
  // Try to find existing user
  let { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();

  if (error && error.code === 'PGRST116') {
    // User doesn't exist, create them
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({ phone_number: phoneNumber })
      .select()
      .single();

    if (createError) throw createError;
    return newUser;
  }

  if (error) throw error;

  // Update last_active_at
  await supabase
    .from('users')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', user.id);

  return user;
}

/**
 * Save a message to conversation history
 */
export async function saveMessage(phoneNumber, userId, role, content) {
  const { error } = await supabase
    .from('messages')
    .insert({
      user_id: userId,
      phone_number: phoneNumber,
      role,
      content,
    });

  if (error) throw error;
}

/**
 * Get conversation history for a user (most recent N messages)
 */
export async function getConversationHistory(phoneNumber, limit = 50) {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('phone_number', phoneNumber)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Update user context (learned information about the person)
 */
export async function updateUserContext(userId, contextUpdate) {
  // Get current context
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('context')
    .eq('id', userId)
    .single();

  if (fetchError) throw fetchError;

  const currentContext = user.context || {};
  const newContext = { ...currentContext, ...contextUpdate };

  const { error } = await supabase
    .from('users')
    .update({ context: newContext, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) throw error;
}

/**
 * Update user display name
 */
export async function updateUserName(userId, displayName) {
  const { error } = await supabase
    .from('users')
    .update({ display_name: displayName, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) throw error;
}

/**
 * Log a crisis event
 */
export async function logCrisis(phoneNumber, userId, triggerMessage, patterns, severity) {
  const { error } = await supabase
    .from('crisis_logs')
    .insert({
      user_id: userId,
      phone_number: phoneNumber,
      trigger_message: triggerMessage,
      detected_patterns: patterns,
      severity,
    });

  if (error) throw error;
}

/**
 * Schedule a check-in for a user
 */
export async function scheduleCheckIn(phoneNumber, userId, reason, scheduledFor) {
  const { error } = await supabase
    .from('checkin_schedule')
    .insert({
      user_id: userId,
      phone_number: phoneNumber,
      reason,
      scheduled_for: scheduledFor,
    });

  if (error) throw error;
}

/**
 * Get pending check-ins that are due
 */
export async function getPendingCheckIns() {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('checkin_schedule')
    .select('*, users(display_name, context)')
    .eq('sent', false)
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Mark a check-in as sent
 */
export async function markCheckInSent(checkInId) {
  const { error } = await supabase
    .from('checkin_schedule')
    .update({ sent: true, sent_at: new Date().toISOString() })
    .eq('id', checkInId);

  if (error) throw error;
}

/**
 * Get users who haven't been active recently (for proactive check-ins)
 */
export async function getInactiveUsers(daysSinceActive = 3) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysSinceActive);

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('is_active', true)
    .lt('last_active_at', cutoff.toISOString())
    .order('last_active_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ═══════════════════════════════════════════
// GOALS & ACCOUNTABILITY
// ═══════════════════════════════════════════

/**
 * Create a new goal for a user
 */
export async function createGoal(phoneNumber, userId, { title, category, description, deadline, frequency }) {
  const { data, error } = await supabase
    .from('goals')
    .insert({
      user_id: userId,
      phone_number: phoneNumber,
      title,
      category: category || null,
      description: description || null,
      deadline: deadline || null,
      frequency: frequency || 'once',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all active goals for a user
 */
export async function getActiveGoals(phoneNumber) {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('phone_number', phoneNumber)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get all goals for a user (any status)
 */
export async function getAllGoals(phoneNumber) {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('phone_number', phoneNumber)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Update a goal's status
 */
export async function updateGoalStatus(goalId, status) {
  const update = { status, updated_at: new Date().toISOString() };
  if (status === 'completed') {
    update.completed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('goals')
    .update(update)
    .eq('id', goalId);

  if (error) throw error;
}

/**
 * Update goal patterns (learned behavioral info)
 */
export async function updateGoalPatterns(goalId, patternsUpdate) {
  const { data: goal, error: fetchError } = await supabase
    .from('goals')
    .select('patterns')
    .eq('id', goalId)
    .single();

  if (fetchError) throw fetchError;

  const currentPatterns = goal.patterns || {};
  const newPatterns = { ...currentPatterns, ...patternsUpdate };

  const { error } = await supabase
    .from('goals')
    .update({ patterns: newPatterns, updated_at: new Date().toISOString() })
    .eq('id', goalId);

  if (error) throw error;
}

/**
 * Add a progress note to a goal
 */
export async function addGoalProgressNote(goalId, note, outcome) {
  const { data: goal, error: fetchError } = await supabase
    .from('goals')
    .select('progress_notes')
    .eq('id', goalId)
    .single();

  if (fetchError) throw fetchError;

  const notes = goal.progress_notes || [];
  notes.push({
    date: new Date().toISOString(),
    note,
    outcome, // 'done', 'partial', 'skipped', 'struggled'
  });

  const { error } = await supabase
    .from('goals')
    .update({ progress_notes: notes, updated_at: new Date().toISOString() })
    .eq('id', goalId);

  if (error) throw error;
}

/**
 * Log a goal check-in
 */
export async function logGoalCheckIn(goalId, userId, phoneNumber, { checkinType, outcome, note, emotionalContext }) {
  const { error } = await supabase
    .from('goal_checkins')
    .insert({
      goal_id: goalId,
      user_id: userId,
      phone_number: phoneNumber,
      checkin_type: checkinType,
      outcome: outcome || null,
      note: note || null,
      emotional_context: emotionalContext || null,
    });

  if (error) throw error;
}

/**
 * Get recent check-ins for a goal (to spot patterns)
 */
export async function getGoalCheckIns(goalId, limit = 20) {
  const { data, error } = await supabase
    .from('goal_checkins')
    .select('*')
    .eq('goal_id', goalId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Record a win
 */
export async function recordWin(userId, phoneNumber, description, category, goalId = null) {
  const { data, error } = await supabase
    .from('wins')
    .insert({
      user_id: userId,
      phone_number: phoneNumber,
      description,
      category: category || null,
      goal_id: goalId,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get recent wins for a user (for celebrating momentum)
 */
export async function getRecentWins(phoneNumber, limit = 10) {
  const { data, error } = await supabase
    .from('wins')
    .select('*')
    .eq('phone_number', phoneNumber)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Get goals with upcoming deadlines (within N hours)
 */
export async function getGoalsWithUpcomingDeadlines(hoursAhead = 24) {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() + hoursAhead);

  const { data, error } = await supabase
    .from('goals')
    .select('*, users(display_name, context)')
    .eq('status', 'active')
    .not('deadline', 'is', null)
    .gte('deadline', now.toISOString())
    .lte('deadline', cutoff.toISOString())
    .order('deadline', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get users with active daily/weekly goals (for routine check-ins)
 */
export async function getUsersWithRecurringGoals() {
  const { data, error } = await supabase
    .from('goals')
    .select('*, users(display_name, context, phone_number)')
    .eq('status', 'active')
    .in('frequency', ['daily', 'weekly'])
    .order('user_id');

  if (error) throw error;
  return data || [];
}

/**
 * Get a summary of a user's accountability data (for context in conversations)
 */
export async function getAccountabilitySummary(phoneNumber) {
  const [goals, wins] = await Promise.all([
    getActiveGoals(phoneNumber),
    getRecentWins(phoneNumber, 5),
  ]);

  return {
    activeGoals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      category: g.category,
      deadline: g.deadline,
      frequency: g.frequency,
    })),
    recentWins: wins.map((w) => ({
      description: w.description,
      date: w.created_at,
    })),
    totalActiveGoals: goals.length,
    totalRecentWins: wins.length,
  };
}

// ═══════════════════════════════════════════
// DATA DELETION
// ═══════════════════════════════════════════

/**
 * Delete all user data (right to be forgotten)
 */
export async function deleteUserData(phoneNumber) {
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('phone_number', phoneNumber)
    .single();

  if (!user) return;

  // Delete in order (foreign keys)
  await supabase.from('goal_checkins').delete().eq('user_id', user.id);
  await supabase.from('wins').delete().eq('user_id', user.id);
  await supabase.from('goals').delete().eq('user_id', user.id);
  await supabase.from('crisis_logs').delete().eq('user_id', user.id);
  await supabase.from('checkin_schedule').delete().eq('user_id', user.id);
  await supabase.from('messages').delete().eq('user_id', user.id);
  await supabase.from('users').delete().eq('id', user.id);
}

export default supabase;
