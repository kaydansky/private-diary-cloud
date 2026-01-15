import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    const { request_id, status, result } = req.body;

    // Log full JSON with pretty formatting
    console.log('[AI-CALLBACK] Received callback:', JSON.stringify(req.body, null, 2));

    if (status !== 'success' || !request_id) {
        console.error('[AI-CALLBACK] Invalid callback data:', JSON.stringify({ request_id, status, result }, null, 2));
        return res.status(400).json({ error: 'Invalid callback data' });
    }

    let reply = null;

    if (result[0].message?.content) {
        reply = result[0].message.content.trim();
    } else if (result[0].choices?.[0]?.message?.content) {
        reply = result[0].choices[0].message.content.trim();
    } else {
        console.error('[AI-CALLBACK] No reply found:', JSON.stringify({ request_id, status, result }, null, 2));
        return res.status(400).json({ error: 'Invalid JSON parsing' });
    }

    if (status === 'error') {
        console.error('[AI-CALLBACK] AI generation error:', JSON.stringify({ request_id, result }, null, 2));
        return res.status(500).json({ error: 'AI generation failed' });
    }

    try {
        console.log('[AI-CALLBACK] Looking up user by request_id or poll_request_id:', JSON.stringify({ request_id }, null, 2));

        // Try to find user by request_id
        let userData = null;
        const { data: dataByRequestId, error: errorByRequestId } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('request_id', request_id)
            .single();

        if (!errorByRequestId && dataByRequestId) {
            userData = dataByRequestId;
            console.log('[AI-CALLBACK] User found by request_id:', JSON.stringify({ userId: userData.id, username: userData.username }, null, 2));
        }

        if (!userData) {
            console.error('[AI-CALLBACK] User lookup failed:', JSON.stringify({ request_id }, null, 2));
            return res.status(500).json({ error: 'User not found' });
        }

        // Process diary entry
        const fireTime = new Date(Date.now() + Math.random() * 15 * 60 * 1000).toISOString();
        const currentDate = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().split('T')[0]; // Current date 'YYYY-MM-DD' in GMT+3
        const payload = {
            user_id: userData.id,
            username: userData.username || null,
            date: currentDate,
            text: reply,
            created_at: fireTime,
            updated_at: fireTime,
            ai_entry: true,
            fire_time: fireTime
        };

        console.log('[AI-CALLBACK] Upserting diary entry:', JSON.stringify({ userId: payload.user_id, date: payload.date }, null, 2));

        const { data: diaryEntry, error: diaryError } = await supabaseAdmin
            .from('diary_entries')
            .upsert(payload)
            .select()
            .single();

        if (diaryError) {
            console.error('[AI-CALLBACK] Diary entry upsert failed:', JSON.stringify({ error: diaryError.message, payload }, null, 2));
            return res.status(500).json({ error: diaryError.message });
        }

        console.log('[AI-CALLBACK] Diary entry saved successfully:', JSON.stringify({ entryId: diaryEntry.id, userId: payload.user_id }, null, 2));

        // Cleanup: Clear processed request ID
        await supabaseAdmin
            .from('users')
            .update({request_id: null})
            .eq('id', userData.id);
    } catch (e) {
        console.error('[AI-CALLBACK] Error:', JSON.stringify({ error: e.message, stack: e.stack }, null, 2));
        return res.status(500).json({ error: e.message });
    }

    console.log('[AI-CALLBACK] Callback completed successfully:', JSON.stringify({ request_id }, null, 2));
    return res.status(200).json({ success: true });
}