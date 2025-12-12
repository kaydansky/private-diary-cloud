import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.6'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { username, type } = await req.json()
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: subscriptions } = await supabaseClient
      .from('push_subscriptions')
      .select('subscription')

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: 'No subscriptions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    webpush.setVapidDetails(
      'mailto:kaydansky@gmail.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!
    )

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

    const results = await Promise.allSettled(
      subscriptions.map(async ({ subscription }) => {
        return await webpush.sendNotification(subscription, payload)
      })
    )

    return new Response(
      JSON.stringify({ 
        message: 'Notifications sent', 
        sent: results.filter(r => r.status === 'fulfilled').length,
        failed: results.filter(r => r.status === 'rejected').length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
