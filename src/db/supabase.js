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

/**
 * Get users who HAVE been active recently (for morning/evening check-ins)
 */
export async function getRecentlyActiveUsers(daysActive = 3) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysActive);

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('is_active', true)
    .gte('last_active_at', cutoff.toISOString())
    .order('last_active_at', { ascending: false });

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
// OPPORTUNITY MONITOR
// ═══════════════════════════════════════════

/**
 * Add a new opportunity to the database
 */
export async function addOpportunity({ title, description, category, subcategory, tags, source, url, deadline, location, eligibility }) {
  const { data, error } = await supabase
    .from('opportunities')
    .insert({
      title,
      description: description || null,
      category,
      subcategory: subcategory || null,
      tags: tags || [],
      source: source || null,
      url: url || null,
      deadline: deadline || null,
      location: location || null,
      eligibility: eligibility || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all active opportunities (optionally filtered by category)
 */
export async function getActiveOpportunities(category = null) {
  let query = supabase
    .from('opportunities')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (category) {
    query = query.eq('category', category);
  }

  // Exclude expired opportunities
  const now = new Date().toISOString();
  query = query.or(`deadline.is.null,deadline.gte.${now}`);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Get opportunities that haven't been sent to a specific user yet
 */
export async function getUnmatchedOpportunitiesForUser(userId) {
  // Get IDs of opportunities already matched to this user
  const { data: existingMatches } = await supabase
    .from('opportunity_matches')
    .select('opportunity_id')
    .eq('user_id', userId);

  const matchedIds = (existingMatches || []).map((m) => m.opportunity_id);

  // Get active opportunities not yet matched
  let query = supabase
    .from('opportunities')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (matchedIds.length > 0) {
    query = query.not('id', 'in', `(${matchedIds.join(',')})`);
  }

  // Exclude expired
  const now = new Date().toISOString();
  query = query.or(`deadline.is.null,deadline.gte.${now}`);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Get user interests for matching
 */
export async function getUserInterests(userId) {
  const { data, error } = await supabase
    .from('user_interests')
    .select('*')
    .eq('user_id', userId)
    .order('strength', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Add or update a user interest
 */
export async function upsertUserInterest(userId, phoneNumber, interest, strength = 'medium', source = 'inferred') {
  // Check if interest already exists
  const { data: existing } = await supabase
    .from('user_interests')
    .select('id, strength')
    .eq('user_id', userId)
    .eq('interest', interest)
    .single();

  if (existing) {
    // Only upgrade strength, never downgrade
    const levels = { low: 1, medium: 2, high: 3 };
    if (levels[strength] > levels[existing.strength]) {
      await supabase
        .from('user_interests')
        .update({ strength, source })
        .eq('id', existing.id);
    }
    return;
  }

  const { error } = await supabase
    .from('user_interests')
    .insert({
      user_id: userId,
      phone_number: phoneNumber,
      interest,
      strength,
      source,
    });

  if (error) throw error;
}

/**
 * Create an opportunity match (schedule sending to a user)
 */
export async function createOpportunityMatch(userId, phoneNumber, opportunityId, matchReason) {
  const { data, error } = await supabase
    .from('opportunity_matches')
    .insert({
      user_id: userId,
      phone_number: phoneNumber,
      opportunity_id: opportunityId,
      match_reason: matchReason,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get pending opportunity matches (ready to send)
 */
export async function getPendingOpportunityMatches() {
  const { data, error } = await supabase
    .from('opportunity_matches')
    .select('*, opportunities(*), users(display_name, context)')
    .eq('sent', false)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Mark an opportunity match as sent
 */
export async function markOpportunityMatchSent(matchId) {
  const { error } = await supabase
    .from('opportunity_matches')
    .update({ sent: true, sent_at: new Date().toISOString() })
    .eq('id', matchId);

  if (error) throw error;
}

/**
 * Update user's response to an opportunity
 */
export async function updateOpportunityResponse(matchId, response, responseNote = null) {
  const { error } = await supabase
    .from('opportunity_matches')
    .update({ response, response_note: responseNote })
    .eq('id', matchId);

  if (error) throw error;
}

/**
 * Get opportunities sent to a user that need follow-up
 * (sent but no response, and sent more than N hours ago)
 */
export async function getOpportunitiesNeedingFollowUp(hoursAgo = 48) {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hoursAgo);

  const { data, error } = await supabase
    .from('opportunity_matches')
    .select('*, opportunities(*), users(display_name, context)')
    .eq('sent', true)
    .eq('followed_up', false)
    .is('response', null)
    .lt('sent_at', cutoff.toISOString());

  if (error) throw error;
  return data || [];
}

/**
 * Mark an opportunity match as followed up
 */
export async function markOpportunityFollowedUp(matchId) {
  const { error } = await supabase
    .from('opportunity_matches')
    .update({ followed_up: true })
    .eq('id', matchId);

  if (error) throw error;
}

/**
 * Get opportunities with approaching deadlines that were sent to users
 * (deadline within N hours, user showed interest or hasn't responded)
 */
export async function getOpportunitiesWithApproachingDeadlines(hoursAhead = 48) {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() + hoursAhead);

  const { data, error } = await supabase
    .from('opportunity_matches')
    .select('*, opportunities(*), users(display_name, context)')
    .eq('sent', true)
    .in('response', ['interested', null])
    .not('opportunities.deadline', 'is', null)
    .gte('opportunities.deadline', now.toISOString())
    .lte('opportunities.deadline', cutoff.toISOString());

  if (error) throw error;
  return data || [];
}

/**
 * Get all users with their interests (for batch matching)
 */
export async function getAllUsersWithInterests() {
  const { data, error } = await supabase
    .from('users')
    .select('*, user_interests(*)')
    .eq('is_active', true);

  if (error) throw error;
  return data || [];
}

/**
 * Expire old opportunities (past deadline)
 */
export async function expireOldOpportunities() {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('opportunities')
    .update({ is_active: false, updated_at: now })
    .eq('is_active', true)
    .not('deadline', 'is', null)
    .lt('deadline', now);

  if (error) throw error;
}

/**
 * Get opportunity summary for a user (for context in conversations)
 */
export async function getOpportunitySummary(phoneNumber) {
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('phone_number', phoneNumber)
    .single();

  if (!user) return { pendingOpportunities: [], interests: [] };

  const [matches, interests] = await Promise.all([
    supabase
      .from('opportunity_matches')
      .select('*, opportunities(title, category, deadline)')
      .eq('user_id', user.id)
      .eq('sent', true)
      .in('response', ['interested', null])
      .order('created_at', { ascending: false })
      .limit(5),
    getUserInterests(user.id),
  ]);

  return {
    pendingOpportunities: (matches.data || []).map((m) => ({
      title: m.opportunities?.title,
      category: m.opportunities?.category,
      deadline: m.opportunities?.deadline,
      response: m.response,
    })),
    interests: interests.map((i) => i.interest),
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
  await supabase.from('opportunity_matches').delete().eq('user_id', user.id);
  await supabase.from('user_interests').delete().eq('user_id', user.id);
  await supabase.from('goal_checkins').delete().eq('user_id', user.id);
  await supabase.from('wins').delete().eq('user_id', user.id);
  await supabase.from('goals').delete().eq('user_id', user.id);
  await supabase.from('crisis_logs').delete().eq('user_id', user.id);
  await supabase.from('checkin_schedule').delete().eq('user_id', user.id);
  await supabase.from('messages').delete().eq('user_id', user.id);
  await supabase.from('users').delete().eq('id', user.id);
}

export default supabase;
