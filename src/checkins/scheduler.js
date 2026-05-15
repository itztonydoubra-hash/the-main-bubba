import cron from 'node-cron';
import { getPendingCheckIns, markCheckInSent, getInactiveUsers, scheduleCheckIn } from '../db/supabase.js';
import { generateCheckInMessage } from '../ai/claude.js';
import { sendMessage } from '../whatsapp/connection.js';

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
      // Schedule a check-in for now (will be picked up by processPendingCheckIns)
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

/**
 * Start the check-in scheduler
 */
export function startCheckInScheduler() {
  const cronExpression = process.env.CHECK_IN_CRON || '0 10 * * *'; // Default: 10am daily

  if (process.env.CHECK_IN_ENABLED !== 'true') {
    console.log('⏸️  Check-in scheduler is disabled (CHECK_IN_ENABLED != true)');
    return;
  }

  // Run the check-in job on schedule
  cron.schedule(cronExpression, async () => {
    console.log('🔔 Running scheduled check-in cycle...');
    await scheduleQuietUserCheckIns();
    await processPendingCheckIns();
  });

  // Also process any already-pending check-ins on startup
  setTimeout(async () => {
    await processPendingCheckIns();
  }, 5000);

  console.log(`⏰ Check-in scheduler started (cron: ${cronExpression})`);
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
