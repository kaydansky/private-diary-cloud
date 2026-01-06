import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.6'

serve(async (req) => {
  // CORS
  const siteUrl = Deno.env.get('SITE_URL') ?? ''
  // Strip trailing slash to avoid CORS mismatch (browser doesn't send trailing slash in Origin header)
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
    const siteUrl = Deno.env.get('SITE_URL') ?? ''

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

    // Validate type field
    if (type !== 'entry' && type !== 'image' && type !== 'poll') {
      console.warn('Invalid type:', type)
      return json({ error: 'Invalid type. Must be: entry, image, or poll' }, 400)
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey)

    // Fetch subscriptions for all users except author
    const { data: subscriptions, error: subError } = await supabaseClient
      .from('push_subscriptions')
      .select('subscription, user_id')
      .neq('user_id', userId)

    if (subError) {
      console.error('Failed to fetch subscriptions:', subError)
      throw subError
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('No subscriptions found for notification')
      return json({ message: 'No subscriptions' }, 200)
    }

    console.log(`Sending notification to ${subscriptions.length} subscribers`)

    // Set VAPID details for web push
    webpush.setVapidDetails(
      'mailto:kaydansky@gmail.com',
      vapidPublic,
      vapidPrivate
    )
    
    const notificationTitle = type === 'entry' 
      ? `Новое сообщение от ${username}` 
      : `Новая картинка от ${username}`
    const notificationBody = type === 'entry' || type === 'poll'
      ? 'Пополнение в летопись СНТ'
      : 'Пополнение в летопись СНТ'

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
        } catch (error) {
          // Log subscription errors but don't fail the whole operation
          console.warn(`Push notification failed for user ${user_id}:`, error.message)
          throw error
        }
      })
    )

    const successful = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    // Log any failures
    if (failed > 0) {
      console.warn(`Notification delivery: ${successful} succeeded, ${failed} failed`)
    }

    return json({ message: 'Notifications sent', sent: successful, failed: failed }, 200)

  } catch (error) {
    console.error('Critical error in send-notification:', error)
    return json({ error: error.message }, 500)
  }
})
