/**
 * Admin Commands
 * 
 * Allows the admin (you) to control Bubba via WhatsApp messages.
 * Only works from the configured admin phone number.
 * 
 * Commands:
 * !add-opp [title] | [url] | [deadline] | [category]
 * !stats — show user count, message count, active goals
 * !broadcast [message] — send a message to all users
 * !users — list all active users
 */

import { addOpportunity } from '../db/supabase.js';
import { sendMessage } from '../whatsapp/connection.js';
import supabase from '../db/supabase.js';

// Admin phone number — only this number can use admin commands
const ADMIN_PHONE = process.env.ADMIN_PHONE || '2347051186987';

/**
 * Check if a message is from the admin
 */
export function isAdmin(phoneNumber) {
  // Handle both regular phone numbers and LID format
  return phoneNumber === ADMIN_PHONE || phoneNumber.includes(ADMIN_PHONE);
}

/**
 * Check if a message is an admin command
 */
export function isAdminCommand(text) {
  return text.startsWith('!');
}

/**
 * Handle an admin command
 * 
 * @param {string} text - The command text
 * @param {string} phoneJid - Admin's JID for sending responses
 * @returns {boolean} true if handled, false if not a valid command
 */
export async function handleAdminCommand(text, phoneJid) {
  const command = text.split(' ')[0].toLowerCase();

  try {
    switch (command) {
      case '!add-opp':
        return await handleAddOpportunity(text, phoneJid);

      case '!stats':
        return await handleStats(phoneJid);

      case '!broadcast':
        return await handleBroadcast(text, phoneJid);

      case '!users':
        return await handleListUsers(phoneJid);

      case '!help':
        return await handleHelp(phoneJid);

      default:
        await sendMessage(phoneJid, 'Unknown command. Send !help for available commands.');
        return true;
    }
  } catch (error) {
    await sendMessage(phoneJid, `Error: ${error.message}`);
    return true;
  }
}

/**
 * !add-opp title | url | deadline | category
 * 
 * Example: !add-opp NDU Moot Court 2026 | https://example.com | 2026-06-15 | academic
 */
async function handleAddOpportunity(text, phoneJid) {
  const parts = text.replace('!add-opp ', '').split('|').map((p) => p.trim());

  if (parts.length < 1 || !parts[0]) {
    await sendMessage(phoneJid, 'Usage: !add-opp title | url | deadline | category\n\nCategories: academic, career, event, skill_building\nDeadline format: YYYY-MM-DD (optional)\nURL: optional');
    return true;
  }

  const title = parts[0];
  const url = parts[1] || null;
  const deadline = parts[2] ? new Date(parts[2]).toISOString() : null;
  const category = parts[3] || 'academic';

  // Validate category
  const validCategories = ['academic', 'career', 'event', 'skill_building'];
  if (!validCategories.includes(category)) {
    await sendMessage(phoneJid, `Invalid category "${category}". Use: ${validCategories.join(', ')}`);
    return true;
  }

  const opp = await addOpportunity({
    title,
    description: title,
    category,
    subcategory: null,
    tags: ['law', 'nigeria'],
    source: 'admin',
    url,
    deadline,
    location: null,
    eligibility: null,
  });

  await sendMessage(phoneJid, `Added: "${title}"\nCategory: ${category}\nDeadline: ${deadline || 'none'}\nURL: ${url || 'none'}\n\nIt will be matched to relevant users at the next cycle (11am/5pm).`);
  return true;
}

/**
 * !stats — show basic statistics
 */
async function handleStats(phoneJid) {
  const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_active', true);
  const { count: messageCount } = await supabase.from('messages').select('*', { count: 'exact', head: true });
  const { count: goalCount } = await supabase.from('goals').select('*', { count: 'exact', head: true }).eq('status', 'active');
  const { count: oppCount } = await supabase.from('opportunities').select('*', { count: 'exact', head: true }).eq('is_active', true);
  const { count: crisisCount } = await supabase.from('crisis_logs').select('*', { count: 'exact', head: true });

  const stats = `Bubba Stats:\n\nUsers: ${userCount || 0}\nMessages: ${messageCount || 0}\nActive goals: ${goalCount || 0}\nOpportunities: ${oppCount || 0}\nCrisis events: ${crisisCount || 0}`;

  await sendMessage(phoneJid, stats);
  return true;
}

/**
 * !broadcast message — send to all active users
 */
async function handleBroadcast(text, phoneJid) {
  const message = text.replace('!broadcast ', '').trim();

  if (!message) {
    await sendMessage(phoneJid, 'Usage: !broadcast Your message here');
    return true;
  }

  const { data: users } = await supabase.from('users').select('phone_number').eq('is_active', true);

  if (!users || users.length === 0) {
    await sendMessage(phoneJid, 'No active users to broadcast to.');
    return true;
  }

  let sent = 0;
  for (const user of users) {
    try {
      const userJid = `${user.phone_number}@s.whatsapp.net`;
      await sendMessage(userJid, message);
      sent++;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (err) {
      // Skip failed sends
    }
  }

  await sendMessage(phoneJid, `Broadcast sent to ${sent}/${users.length} users.`);
  return true;
}

/**
 * !users — list active users
 */
async function handleListUsers(phoneJid) {
  const { data: users } = await supabase
    .from('users')
    .select('display_name, phone_number, last_active_at')
    .eq('is_active', true)
    .order('last_active_at', { ascending: false })
    .limit(20);

  if (!users || users.length === 0) {
    await sendMessage(phoneJid, 'No active users yet.');
    return true;
  }

  const list = users.map((u, i) => {
    const name = u.display_name || 'Unknown';
    const lastActive = new Date(u.last_active_at).toLocaleDateString('en-NG');
    return `${i + 1}. ${name} (last: ${lastActive})`;
  }).join('\n');

  await sendMessage(phoneJid, `Active users (${users.length}):\n\n${list}`);
  return true;
}

/**
 * !help — show available commands
 */
async function handleHelp(phoneJid) {
  const help = `Admin Commands:\n
!add-opp title | url | deadline | category
  Add an opportunity manually

!stats
  Show user/message/goal counts

!broadcast message
  Send a message to all users

!users
  List active users

!help
  Show this message`;

  await sendMessage(phoneJid, help);
  return true;
}
