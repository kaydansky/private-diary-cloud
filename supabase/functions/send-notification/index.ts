// @deno-types="https://deno.land/std@0.168.0/http/server.ts"
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

    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')

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
        const response = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `key=${vapidPrivateKey}`,
          },
          body: JSON.stringify({
            to: subscription.endpoint,
            notification: JSON.parse(payload),
          }),
        })
        return response.json()
      })
    )

    return new Response(
      JSON.stringify({ message: 'Notifications sent', results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
