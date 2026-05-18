/**
 * First-Time User Onboarding
 * 
 * When someone texts Bubba for the first time, she asks a few
 * warm natural questions to get to know them. Feels like a real
 * conversation, not a form.
 * 
 * The onboarding happens naturally — Bubba's system prompt handles
 * the conversational flow. This module just detects first-time users
 * and provides the initial context for the AI to work with.
 */

import { getConversationHistory } from '../db/supabase.js';

/**
 * Check if this is a first-time user (no conversation history)
 * 
 * @param {string} phoneNumber - User's phone number
 * @returns {boolean} true if this is their first message ever
 */
export async function isFirstTimeUser(phoneNumber) {
  const history = await getConversationHistory(phoneNumber, 1);
  return history.length === 0;
}

/**
 * Get the onboarding context to inject into the system prompt
 * for first-time users. This guides the AI to ask warm questions
 * without sounding like a form.
 */
export function getOnboardingContext() {
  return `

IMPORTANT: This is a FIRST-TIME user. They just texted you for the very first time.

Your goals for this first conversation:
1. Be warm and welcoming — not formal, not overly excited. Just real.
2. Introduce yourself briefly: you're Bubba, you're here whenever they need to talk.
3. Get to know them naturally through conversation (DON'T ask all at once):
   - What should you call them?
   - What year/level are they in?
   - What's been on their mind lately?
   - What do they want from this semester or this period of their life?
4. Let THEM lead. If they come in with a problem, address that first. Don't force onboarding questions when someone is in pain.
5. Keep it short and natural. Like meeting someone cool for the first time.

Example first response:
"Hey! I'm Bubba. Glad you texted. What should I call you?"

Then after they respond, naturally ask what year they're in or what brought them here. Don't rush it. Don't list questions. Just talk.

If they start with a heavy topic immediately, skip the intro and help them. You can get to know them over time.`;
}
