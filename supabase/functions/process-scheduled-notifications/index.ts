import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.6'

// TODO: Change to fetch all subscriptions after testing
const TESTER_USER_ID = '387fe574-290c-4120-8915-6088fb4f7d46'
// Cron secret: read from env for security; fallback kept only for quick local testing.
const CRON_KEY = Deno.env.get('CRON_KEY') ?? 'temporary-cron-key-for-testing'

serve(async (req: Request) => {
  // Allow only invocations with the cron key (query `?cron_key=` or header `x-cron-key`).
  try {
    const reqUrl = new URL(req.url)
    const cronKey = reqUrl.searchParams.get('cron_key') || req.headers.get('x-cron-key')
    if (cronKey !== CRON_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    webpush.setVapidDetails(
      'mailto:kaydansky@gmail.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!
    )

    // Fetch pending notifications that are due (fire_time <= now) and not yet sent
    const { data: pendingNotifications, error: fetchError } = await supabaseClient
      .from('diary_entries')
      .select('*')
      .eq('notification_sent', false)
      .not('fire_time', 'is', null)
      .lte('fire_time', new Date().toISOString())
      .order('created_at', { desc: true })
      .limit(10)

    if (fetchError) {
      throw fetchError
    }

    if (!pendingNotifications || pendingNotifications.length === 0) {
      console.log('No pending notifications to process')
      return new Response(JSON.stringify({ message: 'No pending notifications' }), {
        status: 200,
      })
    }

    console.log(`Processing ${pendingNotifications.length} pending notifications`)

    // Fetch subscriptions for all users (currently filtered to tester)
    const { data: subscriptions, error: subError } = await supabaseClient
      .from('push_subscriptions')
      .select('subscription, user_id')
      // .eq('user_id', TESTER_USER_ID)

    if (subError) {
      throw subError
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('No subscriptions found')
      return new Response(JSON.stringify({ message: 'No subscriptions' }), {
        status: 200,
      })
    }

    let totalSent = 0
    let totalFailed = 0

    for (const entry of pendingNotifications) {
      try {
        const notificationTitle = `Новое сообщение от ${entry.username}`;
        const notificationBody = 'Пополнение в летопись СНТ';

        const payload = JSON.stringify({
          title: notificationTitle,
          body: notificationBody,
          icon: `${Deno.env.get('SITE_URL') ?? ''}/assets/icons/icon.svg`,
          badge: `${Deno.env.get('SITE_URL') ?? ''}/assets/icons/icon.svg`,
          data: {
            url: '/',
            date: entry.date,
            entryId: entry.id
          }
        })

        const results = await Promise.allSettled(
          subscriptions.map(async ({ subscription }) => {
            return await webpush.sendNotification(subscription, payload)
          })
        )

        // Track results
        const failedResults = results.filter(r => r.status === 'rejected')
        if (failedResults.length > 0) {
          console.warn(`Entry ${entry.id}: ${failedResults.length}/${subscriptions.length} push notifications failed`)
          failedResults.forEach(r => console.error(r.reason))
        }

        // Mark notification as sent regardless of push results
        await supabaseClient
          .from('diary_entries')
          .update({ notification_sent: true })
          .eq('id', entry.id)

        totalSent += results.filter(r => r.status === 'fulfilled').length
        totalFailed += failedResults.length

      } catch (err) {
        console.error(`Failed to process entry ${entry.id}:`, err)
        totalFailed++
      }
    }

    return new Response(
      JSON.stringify({ 
        message: 'Notifications processed',
        entriesProcessed: pendingNotifications.length,
        notificationsSent: totalSent,
        notificationsFailed: totalFailed,
      }),
      { status: 200 }
    )

  } catch (error) {
    console.error('Critical error in notification processing:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    })
  }
})
