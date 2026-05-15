import dotenv from 'dotenv';
dotenv.config();

import { startWhatsApp, onMessage, sendMessage } from './whatsapp/connection.js';
import { getOrCreateUser, saveMessage, getConversationHistory, updateUserName, logCrisis } from './db/supabase.js';
import { generateResponse } from './ai/claude.js';
import { detectCrisis, needsImmediateEscalation } from './crisis/detector.js';
import { startCheckInScheduler, scheduleFollowUp } from './checkins/scheduler.js';

console.log(`
╔══════════════════════════════════════╗
║          🫂  BUBBA  🫂               ║
║   "I'm not going anywhere."         ║
╚══════════════════════════════════════╝
`);

/**
 * Main message handler — the orchestrator
 * 
 * Flow:
 * 1. Message comes in from WhatsApp
 * 2. Get or create user in Supabase
 * 3. Run crisis detection in parallel
 * 4. Fetch conversation history
 * 5. Call Claude with system prompt + history + new message
 * 6. Save both messages to Supabase
 * 7. Send response back via WhatsApp
 */
async function handleIncomingMessage({ phoneNumber, phoneJid, text, pushName }) {
  console.log(`\n💬 [${phoneNumber}] ${pushName || 'Unknown'}: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

  try {
    // Step 1: Get or create user
    const user = await getOrCreateUser(phoneNumber);

    // Update display name if we have one from WhatsApp and user doesn't have one set
    if (pushName && !user.display_name) {
      await updateUserName(user.id, pushName);
      user.display_name = pushName;
    }

    // Step 2: Crisis detection (runs in parallel with history fetch)
    const crisisResult = detectCrisis(text);

    if (crisisResult.isCrisis) {
      console.log(`⚠️  CRISIS DETECTED [${crisisResult.severity}] for ${phoneNumber}`);
      await logCrisis(phoneNumber, user.id, text, crisisResult.patterns, crisisResult.severity);

      // Schedule a follow-up check-in after crisis
      await scheduleFollowUp(phoneNumber, user.id, `Crisis detected (${crisisResult.severity}) — follow up`, 12);
    }

    // Step 3: Fetch conversation history
    const history = await getConversationHistory(phoneNumber, 50);

    // Step 4: Build messages array for Claude
    const messages = history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Add the new message
    messages.push({ role: 'user', content: text });

    // Step 5: Generate response from Claude
    const response = await generateResponse(messages, user.context || {}, user.display_name);

    // Step 6: Save both messages to Supabase
    await saveMessage(phoneNumber, user.id, 'user', text);
    await saveMessage(phoneNumber, user.id, 'assistant', response);

    // Step 7: Send response back via WhatsApp
    await sendMessage(phoneJid, response);

    console.log(`✅ [${phoneNumber}] Bubba: "${response.substring(0, 80)}${response.length > 80 ? '...' : ''}"`);

    // If critical crisis, log extra warning
    if (needsImmediateEscalation(crisisResult.severity)) {
      console.log(`🚨 CRITICAL CRISIS — ${phoneNumber} may need immediate help`);
    }

  } catch (error) {
    console.error(`❌ Error handling message from ${phoneNumber}:`, error);

    // Try to send a graceful fallback
    try {
      await sendMessage(phoneJid, "Something went weird on my end. Give me a moment and text me again? I'm still here.");
    } catch (sendError) {
      console.error('❌ Failed to send fallback message:', sendError.message);
    }
  }
}

// Handle deletion requests
function isDeleteRequest(text) {
  const deletePatterns = [
    /delete (everything|all|my data)/i,
    /forget (about )?me/i,
    /remove my (data|info|information)/i,
    /i want everything.*deleted/i,
  ];
  return deletePatterns.some((p) => p.test(text));
}

// Start everything
async function main() {
  try {
    // Register message handler
    onMessage(handleIncomingMessage);

    // Start WhatsApp connection
    await startWhatsApp();

    // Start check-in scheduler
    startCheckInScheduler();

  } catch (error) {
    console.error('❌ Fatal error starting Bubba:', error);
    process.exit(1);
  }
}

main();
