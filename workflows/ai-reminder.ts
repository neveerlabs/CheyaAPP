import { sleep } from "workflow";
import { createServiceRoleClient } from "../src/lib/server-supabase";
import { sendPushToAccount } from "../src/lib/server-push";

type ReminderState = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  next_run_at: string;
  active: boolean;
};

async function loadReminder(reminderId: string): Promise<ReminderState | null> {
  "use step";
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("ai_reminders")
    .select("id, user_id, title, body, next_run_at, active")
    .eq("id", reminderId)
    .maybeSingle();
  if (error) throw new Error(`Could not load reminder: ${error.message}`);
  return data;
}

async function deliverReminder(reminderId: string, scheduledAt: string): Promise<{
  userId: string;
  title: string;
  body: string;
  nextRunAt: string | null;
} | null> {
  "use step";
  const client = createServiceRoleClient();
  const { data, error } = await client.rpc("deliver_ai_reminder", {
    p_reminder_id: reminderId,
    p_scheduled_at: scheduledAt,
  });
  if (error) throw new Error(`Could not deliver reminder to chat: ${error.message}`);
  const delivery = data?.[0];
  return delivery
    ? {
        userId: delivery.user_id,
        title: delivery.title,
        body: delivery.body,
        nextRunAt: delivery.next_run_at,
      }
    : null;
}

async function sendReminderPush(userId: string, title: string, body: string): Promise<void> {
  "use step";
  const report = await sendPushToAccount(userId, title, body);
  if (report.failed.length > 0) throw new Error(report.failed.join(" "));
}

export async function createAiReminderWorkflow(reminderId: string): Promise<void> {
  "use workflow";
  while (true) {
    const reminder = await loadReminder(reminderId);
    if (!reminder?.active) return;
    await sleep(new Date(reminder.next_run_at));
    const delivery = await deliverReminder(reminder.id, reminder.next_run_at);
    if (delivery) await sendReminderPush(delivery.userId, delivery.title, delivery.body);
    if (!delivery?.nextRunAt) return;
    const nextReminder = await loadReminder(reminderId);
    if (!nextReminder?.active) return;
  }
}
