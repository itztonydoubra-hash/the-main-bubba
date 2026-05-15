import cron from 'node-cron';
import {
  getPendingCheckIns,
  markCheckInSent,
  getInactiveUsers,
  scheduleCheckIn,
  getGoalsWithUpcomingDeadlines,
  getUsersWithRecurringGoals,
  getActiveGoals,
} from '../db/supabase.js';
import { generateCheckInMessage, generateAccountabilityCheckIn } from '../ai/deepseek.js';
import { sendMessage } from '../whatsapp/connection.js';
import { runOpportunityCycle } from '../opportunities/monitor.js';

// ═══════════════════════════════════════════
// GENERAL CHECK-INS (existing)
// ═══════════════════════════════════════════

/**
 * Process pending check-ins and send them
 */
async function processPendingCheckIns() {
  try {
    const pending = await getPendingCheckIns();

    for (const checkIn of pending) {
      const phoneJid = `${checkIn.phone_number}@s.whatsapp.net`;
      const userName = checkIn.users?.display_name || null;
      const userContext = checkIn.users?.context || {};

      const message = await generateCheckInMessage(userContext, userName, checkIn.reason);

      await sendMessage(phoneJid, message);
      await markCheckInSent(checkIn.id);

      console.log(`📬 Check-in sent to ${checkIn.phone_number}: "${message.substring(0, 50)}..."`);

      // Small delay between messages to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error('❌ Error processing check-ins:', error.message);
  }
}

/**
 * Find users who have gone quiet and schedule check-ins for them
 */
async function scheduleQuietUserCheckIns() {
  try {
    const inactiveUsers = await getInactiveUsers(3); // Inactive for 3+ days

    for (const user of inactiveUsers) {
      await scheduleCheckIn(
        user.phone_number,
        user.id,
        'Went quiet — routine check-in',
        new Date().toISOString()
      );
    }

    if (inactiveUsers.length > 0) {
      console.log(`📋 Scheduled check-ins for ${inactiveUsers.length} quiet user(s)`);
    }
  } catch (error) {
    console.error('❌ Error scheduling quiet user check-ins:', error.message);
  }
}

// ═══════════════════════════════════════════
// ACCOUNTABILITY CHECK-INS (new)
// ═══════════════════════════════════════════

/**
 * Morning accountability check-in for users with daily goals
 * Runs at ~8am — asks what they're tackling today
 */
async function morningAccountabilityCheckIns() {
  try {
    const recurringGoals = await getUsersWithRecurringGoals();

    // Group goals by user
    const userGoals = {};
    for (const goal of recurringGoals) {
      const phone = goal.users?.phone_number || goal.phone_number;
      if (!userGoals[phone]) {
        userGoals[phone] = {
          goals: [],
          userName: goal.users?.display_name || null,
          userContext: goal.users?.context || {},
        };
      }
      userGoals[phone].goals.push(goal);
    }

    for (const [phoneNumber, data] of Object.entries(userGoals)) {
      // Only send daily check-ins for daily goals (weekly ones get checked weekly)
      const dailyGoals = data.goals.filter((g) => g.frequency === 'daily');
      if (dailyGoals.length === 0) continue;

      const phoneJid = `${phoneNumber}@s.whatsapp.net`;
      const goalTitles = dailyGoals.map((g) => g.title);

      const message = await generateAccountabilityCheckIn({
        type: 'morning',
        userName: data.userName,
        userContext: data.userContext,
        goals: goalTitles,
      });

      await sendMessage(phoneJid, message);
      console.log(`🌅 Morning check-in sent to ${phoneNumber} (${dailyGoals.length} daily goal(s))`);

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error('❌ Error in morning accountability check-ins:', error.message);
  }
}

/**
 * Evening accountability check-in — asks how the day went
 * Runs at ~9pm
 */
async function eveningAccountabilityCheckIns() {
  try {
    const recurringGoals = await getUsersWithRecurringGoals();

    // Group goals by user
    const userGoals = {};
    for (const goal of recurringGoals) {
      const phone = goal.users?.phone_number || goal.phone_number;
      if (!userGoals[phone]) {
        userGoals[phone] = {
          goals: [],
          userName: goal.users?.display_name || null,
          userContext: goal.users?.context || {},
        };
      }
      userGoals[phone].goals.push(goal);
    }

    for (const [phoneNumber, data] of Object.entries(userGoals)) {
      const dailyGoals = data.goals.filter((g) => g.frequency === 'daily');
      if (dailyGoals.length === 0) continue;

      const phoneJid = `${phoneNumber}@s.whatsapp.net`;
      const goalTitles = dailyGoals.map((g) => g.title);

      const message = await generateAccountabilityCheckIn({
        type: 'evening',
        userName: data.userName,
        userContext: data.userContext,
        goals: goalTitles,
      });

      await sendMessage(phoneJid, message);
      console.log(`🌙 Evening check-in sent to ${phoneNumber} (${dailyGoals.length} daily goal(s))`);

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error('❌ Error in evening accountability check-ins:', error.message);
  }
}

/**
 * Deadline-based check-in — nudge users about goals with upcoming deadlines
 */
async function deadlineCheckIns() {
  try {
    const upcomingGoals = await getGoalsWithUpcomingDeadlines(24); // Due within 24h

    for (const goal of upcomingGoals) {
      const phoneJid = `${goal.phone_number}@s.whatsapp.net`;
      const userName = goal.users?.display_name || null;
      const userContext = goal.users?.context || {};

      const message = await generateAccountabilityCheckIn({
        type: 'deadline',
        userName,
        userContext,
        goals: [goal.title],
        deadline: goal.deadline,
      });

      await sendMessage(phoneJid, message);
      console.log(`⏰ Deadline check-in sent to ${goal.phone_number}: "${goal.title}" due soon`);

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error('❌ Error in deadline check-ins:', error.message);
  }
}

/**
 * Silence-based accountability check-in
 * For users who have active goals but haven't texted in a while
 */
async function silenceAccountabilityCheckIns() {
  try {
    const inactiveUsers = await getInactiveUsers(2); // 2+ days quiet

    for (const user of inactiveUsers) {
      const goals = await getActiveGoals(user.phone_number);
      if (goals.length === 0) continue; // Only nudge if they have active goals

      const phoneJid = `${user.phone_number}@s.whatsapp.net`;
      const goalTitles = goals.map((g) => g.title).slice(0, 3); // Top 3

      const message = await generateAccountabilityCheckIn({
        type: 'silence',
        userName: user.display_name,
        userContext: user.context || {},
        goals: goalTitles,
      });

      await sendMessage(phoneJid, message);
      console.log(`🤫 Silence check-in sent to ${user.phone_number} (${goals.length} active goal(s))`);

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error('❌ Error in silence accountability check-ins:', error.message);
  }
}

// ═══════════════════════════════════════════
// SCHEDULER STARTUP
// ═══════════════════════════════════════════

/**
 * Start the full check-in scheduler (general + accountability)
 */
export function startCheckInScheduler() {
  if (process.env.CHECK_IN_ENABLED !== 'true') {
    console.log('⏸️  Check-in scheduler is disabled (CHECK_IN_ENABLED != true)');
    return;
  }

  // General check-in cycle (default: 10am daily)
  const generalCron = process.env.CHECK_IN_CRON || '0 10 * * *';
  cron.schedule(generalCron, async () => {
    console.log('🔔 Running general check-in cycle...');
    await scheduleQuietUserCheckIns();
    await processPendingCheckIns();
  });

  // Morning accountability check-in (8am WAT)
  cron.schedule('0 8 * * *', async () => {
    console.log('🌅 Running morning accountability check-ins...');
    await morningAccountabilityCheckIns();
  });

  // Evening accountability check-in (9pm WAT)
  cron.schedule('0 21 * * *', async () => {
    console.log('🌙 Running evening accountability check-ins...');
    await eveningAccountabilityCheckIns();
  });

  // Deadline check-ins (every 6 hours)
  cron.schedule('0 */6 * * *', async () => {
    console.log('⏰ Running deadline check-ins...');
    await deadlineCheckIns();
  });

  // Silence-based accountability (2pm daily — mid-day nudge)
  cron.schedule('0 14 * * *', async () => {
    console.log('🤫 Running silence accountability check-ins...');
    await silenceAccountabilityCheckIns();
  });

  // Opportunity cycle (11am and 5pm daily — match, deliver, follow up, nudge)
  cron.schedule('0 11 * * *', async () => {
    console.log('🎯 Running opportunity cycle (morning)...');
    await runOpportunityCycle();
  });

  cron.schedule('0 17 * * *', async () => {
    console.log('🎯 Running opportunity cycle (evening)...');
    await runOpportunityCycle();
  });

  // Process any already-pending check-ins on startup
  setTimeout(async () => {
    await processPendingCheckIns();
  }, 5000);

  console.log(`⏰ Check-in scheduler started:`);
  console.log(`   📬 General: ${generalCron}`);
  console.log(`   🌅 Morning accountability: 0 8 * * *`);
  console.log(`   🌙 Evening accountability: 0 21 * * *`);
  console.log(`   ⏰ Deadline nudges: every 6h`);
  console.log(`   🤫 Silence nudges: 0 14 * * *`);
  console.log(`   🎯 Opportunities: 0 11,17 * * *`);
}

/**
 * Schedule a follow-up check-in after a heavy conversation or crisis
 */
export async function scheduleFollowUp(phoneNumber, userId, reason, hoursFromNow = 24) {
  const scheduledFor = new Date();
  scheduledFor.setHours(scheduledFor.getHours() + hoursFromNow);

  await scheduleCheckIn(phoneNumber, userId, reason, scheduledFor.toISOString());
  console.log(`📅 Follow-up scheduled for ${phoneNumber} in ${hoursFromNow}h: "${reason}"`);
}
