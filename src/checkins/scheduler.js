import cron from 'node-cron';
import {
  getPendingCheckIns,
  markCheckInSent,
  getInactiveUsers,
  getRecentlyActiveUsers,
  scheduleCheckIn,
  getGoalsWithUpcomingDeadlines,
  getUsersWithRecurringGoals,
  getActiveGoals,
  resetTodaysFailedCheckIns,
} from '../db/supabase.js';
import { generateCheckInMessage, generateAccountabilityCheckIn } from '../ai/deepseek.js';
import { sendMessage } from '../whatsapp/connection.js';
import { runOpportunityCycle } from '../opportunities/monitor.js';
import { sendWeeklyDigests } from '../checkins/weekly-digest.js';
import { processReminders } from '../reminders/reminders.js';

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
 * Works for ALL users — not just those with goals
 */
async function scheduleQuietUserCheckIns() {
  try {
    const inactiveUsers = await getInactiveUsers(3); // Inactive for 3+ days

    for (const user of inactiveUsers) {
      // Check if we already have a pending check-in for this user (avoid spam)
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
 * Schedules into checkin_schedule table, then processes pending
 * Runs at 7am UTC (8am WAT)
 */
async function scheduleMorningCheckIns() {
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
          userId: goal.user_id,
        };
      }
      userGoals[phone].goals.push(goal);
    }

    let scheduled = 0;
    for (const [phoneNumber, data] of Object.entries(userGoals)) {
      const dailyGoals = data.goals.filter((g) => g.frequency === 'daily');
      if (dailyGoals.length === 0) continue;

      const goalTitles = dailyGoals.map((g) => g.title).join(', ');
      await scheduleCheckIn(
        phoneNumber,
        data.userId,
        `Morning accountability — daily goals: ${goalTitles}`,
        new Date().toISOString()
      );
      scheduled++;
    }

    // Fallback: if no users have daily goals, reach out to recently active users
    if (scheduled === 0) {
      const recentUsers = await getRecentlyActiveUsers(3);
      for (const user of recentUsers) {
        await scheduleCheckIn(
          user.phone_number,
          user.id,
          'Morning check-in — staying connected',
          new Date().toISOString()
        );
      }
      if (recentUsers.length > 0) {
        console.log(`🌅 No daily goals found, scheduled ${recentUsers.length} recently active user(s) instead`);
      }
    } else {
      console.log(`🌅 Scheduled morning check-ins for ${scheduled} user(s) with daily goals`);
    }

    await processPendingCheckIns();
  } catch (error) {
    console.error('❌ Error in morning accountability check-ins:', error.message);
  }
}

/**
 * Evening accountability check-in — asks how the day went
 * Schedules into checkin_schedule table, then processes pending
 * Runs at 8pm UTC (9pm WAT)
 */
async function scheduleEveningCheckIns() {
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
          userId: goal.user_id,
        };
      }
      userGoals[phone].goals.push(goal);
    }

    let scheduled = 0;
    for (const [phoneNumber, data] of Object.entries(userGoals)) {
      const dailyGoals = data.goals.filter((g) => g.frequency === 'daily');
      if (dailyGoals.length === 0) continue;

      const goalTitles = dailyGoals.map((g) => g.title).join(', ');
      await scheduleCheckIn(
        phoneNumber,
        data.userId,
        `Evening accountability — how did today go: ${goalTitles}`,
        new Date().toISOString()
      );
      scheduled++;
    }

    // Fallback: if no users have daily goals, reach out to recently active users
    if (scheduled === 0) {
      const recentUsers = await getRecentlyActiveUsers(3);
      for (const user of recentUsers) {
        await scheduleCheckIn(
          user.phone_number,
          user.id,
          'Evening check-in — how was your day',
          new Date().toISOString()
        );
      }
      if (recentUsers.length > 0) {
        console.log(`🌙 No daily goals found, scheduled ${recentUsers.length} recently active user(s) instead`);
      }
    } else {
      console.log(`🌙 Scheduled evening check-ins for ${scheduled} user(s) with daily goals`);
    }

    await processPendingCheckIns();
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
 * Schedules into checkin_schedule table, then processes pending
 */
async function silenceAccountabilityCheckIns() {
  try {
    const inactiveUsers = await getInactiveUsers(2); // 2+ days quiet

    for (const user of inactiveUsers) {
      const goals = await getActiveGoals(user.phone_number);
      if (goals.length === 0) continue; // Only nudge if they have active goals

      const goalTitles = goals.map((g) => g.title).slice(0, 3).join(', ');
      await scheduleCheckIn(
        user.phone_number,
        user.id,
        `Silence nudge — active goals: ${goalTitles}`,
        new Date().toISOString()
      );

      console.log(`🤫 Scheduled silence check-in for ${user.phone_number} (${goals.length} active goal(s))`);
    }

    await processPendingCheckIns();
  } catch (error) {
    console.error('❌ Error in silence accountability check-ins:', error.message);
  }
}

/**
 * Exam season check-ins — more frequent, more supportive
 * Runs during late May and early June (NDU exam periods)
 * Schedules into checkin_schedule table, then processes pending
 */
async function examSeasonCheckIns() {
  try {
    const inactiveUsers = await getInactiveUsers(1); // Even 1 day quiet during exams

    for (const user of inactiveUsers) {
      await scheduleCheckIn(
        user.phone_number,
        user.id,
        'Exam season — checking in on how they are holding up',
        new Date().toISOString()
      );

      console.log(`📚 Scheduled exam season check-in for ${user.phone_number}`);
    }

    await processPendingCheckIns();
  } catch (error) {
    console.error('❌ Error in exam season check-ins:', error.message);
  }
}

// ═══════════════════════════════════════════
// SCHEDULER STARTUP
// ═══════════════════════════════════════════

/**
 * Start the full check-in scheduler (general + accountability)
 * 
 * All cron times are in UTC.
 * WAT (West Africa Time) = UTC+1, so we subtract 1 hour.
 */
export function startCheckInScheduler() {
  if (process.env.CHECK_IN_ENABLED !== 'true') {
    console.log('⏸️  Check-in scheduler is disabled (CHECK_IN_ENABLED != true)');
    return;
  }

  // General check-in cycle (9am UTC = 10am WAT daily — catches quiet users)
  const generalCron = process.env.CHECK_IN_CRON || '0 9 * * *';
  cron.schedule(generalCron, async () => {
    console.log('🔔 Running general check-in cycle...');
    await scheduleQuietUserCheckIns();
    await processPendingCheckIns();
  });

  // Morning accountability check-in (7am UTC = 8am WAT)
  cron.schedule('0 7 * * *', async () => {
    console.log('🌅 Running morning accountability check-ins...');
    await scheduleMorningCheckIns();
  });

  // Evening accountability check-in (8pm UTC = 9pm WAT)
  cron.schedule('0 20 * * *', async () => {
    console.log('🌙 Running evening accountability check-ins...');
    await scheduleEveningCheckIns();
  });

  // Deadline check-ins (every 6 hours)
  cron.schedule('0 */6 * * *', async () => {
    console.log('⏰ Running deadline check-ins...');
    await deadlineCheckIns();
  });

  // Silence-based accountability (1pm UTC = 2pm WAT daily — mid-day nudge)
  cron.schedule('0 13 * * *', async () => {
    console.log('🤫 Running silence accountability check-ins...');
    await silenceAccountabilityCheckIns();
  });

  // Exam season intensified check-ins (late May and early June)
  // 6am UTC = 7am WAT — last days of May
  cron.schedule('0 6 27-31 5 *', async () => {
    console.log('📚 Exam season check-in (late May)...');
    await examSeasonCheckIns();
  });

  // 6am UTC = 7am WAT — first days of June
  cron.schedule('0 6 1-9 6 *', async () => {
    console.log('📚 Exam season check-in (early June)...');
    await examSeasonCheckIns();
  });

  // Opportunity cycle (10am UTC = 11am WAT and 4pm UTC = 5pm WAT daily)
  cron.schedule('0 10 * * *', async () => {
    console.log('🎯 Running opportunity cycle (morning)...');
    await runOpportunityCycle();
  });

  cron.schedule('0 16 * * *', async () => {
    console.log('🎯 Running opportunity cycle (evening)...');
    await runOpportunityCycle();
  });

  // Weekly reflection digest (Sunday 7pm UTC = Sunday 8pm WAT)
  cron.schedule('0 19 * * 0', async () => {
    console.log('📝 Running weekly reflection digest...');
    await sendWeeklyDigests();
  });

  // Reminder check (every minute — checks for due reminders)
  cron.schedule('* * * * *', async () => {
    await processReminders();
  });

  // On startup: reset today's failed check-ins (from broken session) and re-deliver
  setTimeout(async () => {
    const resetCount = await resetTodaysFailedCheckIns();
    if (resetCount > 0) {
      console.log(`🔄 Reset ${resetCount} failed check-in(s) from today — re-delivering...`);
    }
    await processPendingCheckIns();
  }, 5000);

  console.log(`⏰ Check-in scheduler started (all times UTC):`);
  console.log(`   📬 General: ${generalCron}`);
  console.log(`   🌅 Morning accountability: 7am UTC (8am WAT)`);
  console.log(`   🌙 Evening accountability: 8pm UTC (9pm WAT)`);
  console.log(`   ⏰ Deadline nudges: every 6h`);
  console.log(`   🤫 Silence nudges: 1pm UTC (2pm WAT)`);
  console.log(`   📚 Exam season: 6am UTC (7am WAT) — May 27-31, Jun 1-9`);
  console.log(`   🎯 Opportunities: 10am UTC (11am WAT), 4pm UTC (5pm WAT)`);
  console.log(`   📝 Weekly digest: Sunday 7pm UTC (8pm WAT)`);
  console.log(`   ⏰ Reminders: every minute`);
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
