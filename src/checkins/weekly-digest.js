/**
 * Weekly Reflection Digest
 * 
 * Every Sunday evening (8pm WAT), Bubba sends each active user
 * a personalized reflection on their week — based on what they
 * actually talked about, not generic motivational fluff.
 */

import { getConversationHistory, getRecentWins, getActiveGoals } from '../db/supabase.js';
import { sendMessage } from '../whatsapp/connection.js';
import supabase from '../db/supabase.js';
import OpenAI from 'openai';
import { BUBBA_SYSTEM_PROMPT } from '../prompts/system.js';

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

/**
 * Generate a personalized weekly reflection for a user
 */
async function generateWeeklyReflection(phoneNumber, userName, userContext) {
  // Get this week's conversation history
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Fetch recent messages (last 7 days worth)
  const history = await getConversationHistory(phoneNumber, 100);
  const thisWeek = history.filter((msg) => new Date(msg.created_at) > sevenDaysAgo);

  if (thisWeek.length < 4) {
    // Not enough conversation to reflect on
    return null;
  }

  // Get wins and goals for context
  const [wins, goals] = await Promise.all([
    getRecentWins(phoneNumber, 5),
    getActiveGoals(phoneNumber),
  ]);

  // Build a summary of the week for the AI
  const weekSummary = thisWeek.map((m) => `${m.role}: ${m.content}`).join('\n');

  const systemPrompt = BUBBA_SYSTEM_PROMPT + `

You are sending a WEEKLY REFLECTION to this person. It's Sunday evening.

Based on their conversations this week, write a short, warm, personal reflection. NOT a report. NOT a summary. A reflection — like a friend who noticed how their week went.

Rules:
- 3-5 short messages max
- Reference SPECIFIC things they said or did this week
- Celebrate progress (even tiny)
- Acknowledge struggles without minimizing
- End with something forward-looking for next week
- Do NOT list everything — pick 2-3 highlights
- Do NOT use bullet points or numbered lists
- Sound like a text, not a newsletter

${userName ? `Their name: ${userName}` : ''}
${wins.length > 0 ? `Wins this week: ${wins.map(w => w.description).join(', ')}` : ''}
${goals.length > 0 ? `Active goals: ${goals.map(g => g.title).join(', ')}` : ''}`;

  try {
    const response = await deepseek.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      max_tokens: 512,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Here are their conversations from this week:\n\n${weekSummary.substring(0, 3000)}\n\n[SYSTEM: Generate a weekly reflection for this person based on the above.]` },
      ],
      temperature: 0.9,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('❌ Error generating weekly reflection:', error.message);
    return null;
  }
}

/**
 * Send weekly reflections to all active users
 * Called by the scheduler every Sunday at 8pm WAT
 */
export async function sendWeeklyDigests() {
  console.log('📝 Generating weekly reflections...');

  try {
    // Get all active users
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('is_active', true);

    if (error) throw error;
    if (!users || users.length === 0) return;

    let sent = 0;

    for (const user of users) {
      const reflection = await generateWeeklyReflection(
        user.phone_number,
        user.display_name,
        user.context || {}
      );

      if (!reflection) continue; // Skip users with too little activity

      const phoneJid = `${user.phone_number}@s.whatsapp.net`;
      await sendMessage(phoneJid, reflection);
      sent++;

      console.log(`   📝 Weekly reflection sent to ${user.phone_number}`);

      // Delay between messages
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    console.log(`✅ Weekly reflections sent to ${sent} user(s)`);
  } catch (error) {
    console.error('❌ Error sending weekly digests:', error.message);
  }
}
