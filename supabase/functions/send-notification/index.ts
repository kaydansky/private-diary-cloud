import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.6'

serve(async (req) => {
  // CORS
  const siteUrl = 'https://chat.snt-tishinka.ru'
  const allowedOrigin = siteUrl.replace(/\/$/, '') || '*'
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    // Validate environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')

    if (!supabaseUrl || !supabaseKey || !vapidPublic || !vapidPrivate) {
      console.error('Missing required environment variables')
      return json({ error: 'Server configuration error' }, 500)
    }

    // Parse and validate request body
    let body
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON in request body' }, 400)
    }

    const { username, userId, type, date, entryId } = body

    // Validate required fields
    if (!username || !userId || !type || !date) {
      console.warn('Missing required fields:', { username, userId, type, date })
      return json({ error: 'Missing required fields: username, userId, type, date' }, 400)
    }

    if (type !== 'entry' && type !== 'image' && type !== 'poll') {
      console.warn('Invalid type:', type)
      return json({ error: 'Invalid type. Must be: entry, image, or poll' }, 400)
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey)

    // Fetch subscriptions for all users except author
    const { data: subscriptionsData, error: subError } = await supabaseClient
      .from('push_subscriptions')
      .select('subscription, user_id')
      .neq('user_id', userId)

    if (subError) {
      console.error('Failed to fetch subscriptions:', subError)
      throw subError
    }

    if (!subscriptionsData || subscriptionsData.length === 0) {
      console.log('No subscriptions found for notification')
      return json({ message: 'No subscriptions' }, 200)
    }

    // === DEDUPLICATION: Remove duplicate subscriptions by endpoint ===
    const uniqueSubs = new Map<string, { subscription: any; user_id: string }>()
    for (const { subscription, user_id } of subscriptionsData) {
      const endpoint = subscription?.endpoint
      if (endpoint && !uniqueSubs.has(endpoint)) {
        uniqueSubs.set(endpoint, { subscription, user_id })
      }
    }

    const subscriptions = Array.from(uniqueSubs.values())

    console.log(`Sending notification to ${subscriptions.length} unique subscribers (deduplicated from ${subscriptionsData.length} rows)`)

    // Set VAPID details for web push
    webpush.setVapidDetails(
      'mailto:kaydansky@gmail.com',
      vapidPublic,
      vapidPrivate
    )

    function getRandomItem(arr: string[]): string {
      const index = Math.floor(Math.random() * arr.length);
      return arr[index];
    }
    const titles = ["цинкует в чат", "тусует маляву"];
    const bodies = ["Прогон по СНТ", "Между нами, колдунами"];
    const randomTitle = getRandomItem(titles);
    const randomBody = getRandomItem(bodies);

    const notificationTitle = type === 'entry'
      ? `${username} ${randomTitle}`
      : type === 'poll'
      ? `Новый опрос от ${username}`
      : `Новое изображение от ${username}`

    const notificationBody = randomBody;

    const payload = JSON.stringify({
      title: notificationTitle,
      body: notificationBody,
      icon: `${siteUrl}/assets/icons/icon.svg`,
      badge: `${siteUrl}/assets/icons/icon.svg`,
      data: {
        url: '/',
        date: date,
        entryId: entryId
      }
    })

    const results = await Promise.allSettled(
      subscriptions.map(async ({ subscription, user_id }) => {
        try {
          return await webpush.sendNotification(subscription, payload)
        } catch (error: any) {
          // === IMPROVED DETAILED LOGGING ===
          const statusCode = error.statusCode || error.code
          const endpointPreview = subscription?.endpoint
            ? subscription.endpoint.substring(0, 80) + '...'
            : 'unknown'

          console.warn(`Push notification failed for user ${user_id}:`, {
            statusCode,
            body: error.body || error.message,
            endpoint: endpointPreview,
          })

          // === CRITICAL: Auto-clean dead subscriptions (410 = expired/unsubscribed) ===
          if (statusCode === 410 || statusCode === 404) {
            console.log(`🗑️ Deleting expired subscription for user ${user_id}`)

            const { error: deleteError } = await supabaseClient
              .from('push_subscriptions')
              .delete()
              .eq('user_id', user_id)
              .eq('endpoint', subscription.endpoint)

            if (deleteError) {
              console.error(`Failed to delete expired subscription for user ${user_id}:`, deleteError)
            }
          }

          throw error // keep it as rejected in Promise.allSettled
        }
      })
    )

    const successful = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    if (failed > 0) {
      console.warn(`Notification delivery: ${successful} succeeded, ${failed} failed`)
    } else {
      console.log(`✅ All ${successful} notifications delivered successfully`)
    }

    return json({
      message: 'Notifications sent',
      sent: successful,
      failed: failed,
      totalUnique: subscriptions.length
    }, 200)

  } catch (error) {
    console.error('Critical error in send-notification:', error)
    return json({ error: error.message }, 500)
  }
})