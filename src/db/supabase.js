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
  await supabase.from('crisis_logs').delete().eq('user_id', user.id);
  await supabase.from('checkin_schedule').delete().eq('user_id', user.id);
  await supabase.from('messages').delete().eq('user_id', user.id);
  await supabase.from('users').delete().eq('id', user.id);
}

export default supabase;
