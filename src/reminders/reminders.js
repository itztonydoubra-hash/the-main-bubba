/**
 * Reminder System
 * 
 * Allows users to set reminders through natural conversation.
 * Bubba detects when someone asks for a reminder, parses the time,
 * saves it to Supabase, and delivers it when due.
 * 
 * Examples:
 * - "Remind me to study in 30 minutes"
 * - "Text me at 8pm"
 * - "Remind me about the assignment tomorrow"
 * - "Wake me up in 2 hours"
 */

import supabase from '../db/supabase.js';
import { sendMessage } from '../whatsapp/connection.js';

// ═══════════════════════════════════════════
// REMINDER DETECTION
// ═══════════════════════════════════════════

const REMINDER_PATTERNS = [
  // "remind me in X minutes/hours"
  /remind\s+me\s+(?:to\s+(.+?)\s+)?in\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|h)/i,
  // "remind me to X in Y"
  /remind\s+me\s+to\s+(.+?)\s+in\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|h|days?)/i,
  // "text me in X minutes/hours"
  /text\s+me\s+(?:(?:about\s+)?(.+?)\s+)?in\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|h)/i,
  // "remind me at Xpm/am"
  /remind\s+me\s+(?:to\s+(.+?)\s+)?at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
  // "text me at Xpm/am"
  /text\s+me\s+(?:(?:about\s+)?(.+?)\s+)?at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
  // "remind me tomorrow"
  /remind\s+me\s+(?:to\s+(.+?)\s+)?tomorrow/i,
  // "wake me up in X"
  /wake\s+me\s+(?:up\s+)?in\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|h)/i,
  // "set a reminder for X minutes"
  /set\s+(?:a\s+)?reminder\s+(?:for\s+)?(?:(.+?)\s+)?(?:in\s+)?(\d+)\s*(min(?:ute)?s?|hours?|hrs?|h)/i,
];

/**
 * Check if a message contains a reminder request
 * Returns parsed reminder data or null
 */
export function detectReminder(text) {
  const lower = text.toLowerCase();

  // Quick check — does it even mention reminding?
  if (!lower.includes('remind') && !lower.includes('text me') && !lower.includes('wake me') && !lower.includes('reminder')) {
    return null;
  }

  // Try "in X minutes/hours" patterns
  const relativeMatch = lower.match(/(?:remind|text|wake)\s+me\s+(?:up\s+)?(?:to\s+(.+?)\s+)?in\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|h|days?)/i);
  if (relativeMatch) {
    const task = relativeMatch[1] || 'check in';
    const amount = parseInt(relativeMatch[2]);
    const unit = relativeMatch[3].toLowerCase();

    let ms = 0;
    if (unit.startsWith('min')) ms = amount * 60 * 1000;
    else if (unit.startsWith('h')) ms = amount * 60 * 60 * 1000;
    else if (unit.startsWith('day')) ms = amount * 24 * 60 * 60 * 1000;

    const scheduledFor = new Date(Date.now() + ms);
    return { task: task.trim(), scheduledFor, humanTime: `${amount} ${unit}` };
  }

  // Try "at X pm/am" patterns
  const atMatch = lower.match(/(?:remind|text)\s+me\s+(?:to\s+(.+?)\s+)?at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (atMatch) {
    const task = atMatch[1] || 'check in';
    let hour = parseInt(atMatch[2]);
    const minutes = parseInt(atMatch[3] || '0');
    const period = atMatch[4];

    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    const scheduledFor = new Date();
    scheduledFor.setHours(hour, minutes, 0, 0);

    // If the time has passed today, schedule for tomorrow
    if (scheduledFor < new Date()) {
      scheduledFor.setDate(scheduledFor.getDate() + 1);
    }

    const timeStr = `${atMatch[2]}${atMatch[3] ? ':' + atMatch[3] : ''}${period}`;
    return { task: task.trim(), scheduledFor, humanTime: timeStr };
  }

  // Try "tomorrow" pattern
  const tomorrowMatch = lower.match(/remind\s+me\s+(?:to\s+(.+?)\s+)?tomorrow/i);
  if (tomorrowMatch) {
    const task = tomorrowMatch[1] || 'check in';
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + 1);
    scheduledFor.setHours(9, 0, 0, 0); // Default to 9am tomorrow

    return { task: task.trim(), scheduledFor, humanTime: 'tomorrow morning' };
  }

  return null;
}

// ═══════════════════════════════════════════
// REMINDER STORAGE
// ═══════════════════════════════════════════

/**
 * Save a reminder to Supabase (uses checkin_schedule table)
 */
export async function saveReminder(phoneNumber, userId, task, scheduledFor) {
  const reason = `⏰ Reminder: ${task}`;

  const { error } = await supabase
    .from('checkin_schedule')
    .insert({
      user_id: userId,
      phone_number: phoneNumber,
      reason,
      scheduled_for: scheduledFor.toISOString(),
    });

  if (error) throw error;
}

// ═══════════════════════════════════════════
// REMINDER DELIVERY
// ═══════════════════════════════════════════

/**
 * Process due reminders — called by the scheduler every minute
 * 
 * This picks up reminders from checkin_schedule where:
 * - reason starts with "⏰ Reminder:"
 * - scheduled_for is in the past
 * - sent is false
 */
export async function processReminders() {
  try {
    const now = new Date().toISOString();

    const { data: reminders, error } = await supabase
      .from('checkin_schedule')
      .select('*, users(display_name)')
      .eq('sent', false)
      .lte('scheduled_for', now)
      .like('reason', '⏰ Reminder:%');

    if (error) throw error;
    if (!reminders || reminders.length === 0) return;

    for (const reminder of reminders) {
   const phone = reminder.phone_number;
const phoneJid = `${phone}@lid`;
const userName = reminder.users?.display_name || '';
      const task = reminder.reason.replace('⏰ Reminder: ', '');

      // Send the reminder in Bubba's voice
      const message = userName
        ? `Hey ${userName}. You asked me to remind you: "${task}"`
        : `Hey. You asked me to remind you: "${task}"`;

      await sendMessage(phoneJid, message);

      // Mark as sent
      await supabase
        .from('checkin_schedule')
        .update({ sent: true, sent_at: now })
        .eq('id', reminder.id);

      console.log(`⏰ Reminder delivered to ${reminder.phone_number}: "${task}"`);

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('❌ Error processing reminders:', error.message);
  }
}
