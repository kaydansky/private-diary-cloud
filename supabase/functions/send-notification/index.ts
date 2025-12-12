import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('Received notification request')
    const { username, type } = await req.json()
    console.log('Username:', username, 'Type:', type)
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: subscriptions, error: dbError } = await supabaseClient
      .from('push_subscriptions')
      .select('subscription')

    console.log('Subscriptions found:', subscriptions?.length || 0)
    if (dbError) console.error('DB Error:', dbError)

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: 'No subscriptions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const notificationTitle = type === 'entry' 
      ? `New Entry by ${username}` 
      : `New Image by ${username}`
    const notificationBody = type === 'entry'
      ? 'Someone shared a new diary entry'
      : 'Someone shared a new image'

    const payload = JSON.stringify({
      title: notificationTitle,
      body: notificationBody,
      icon: '/assets/icons/icon.svg',
      badge: '/assets/icons/icon.svg',
    })

    console.log('Sending to', subscriptions.length, 'subscribers')

    // Use web-push-deno library
    const webPush = await import('https://deno.land/x/web_push@0.0.6/mod.ts')
    
    webPush.setVapidDetails(
      'mailto:kaydansky@gmail.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!
    )

    const results = await Promise.allSettled(
      subscriptions.map(async ({ subscription }) => {
        try {
          return await webPush.sendNotification(subscription, payload)
        } catch (err) {
          console.error('Send error:', err)
          throw err
        }
      })
    )

    console.log('Results:', results.map(r => r.status))

    return new Response(
      JSON.stringify({ 
        message: 'Notifications sent', 
        sent: results.filter(r => r.status === 'fulfilled').length,
        failed: results.filter(r => r.status === 'rejected').length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Function error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
