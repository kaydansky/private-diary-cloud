import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    const { request_id, status, output, result } = req.body;

    console.log(`[AI-CALLBACK] Received callback:`, { request_id, status, hasOutput: !!output });

    if (status !== 'success' || !request_id || !output) {
        console.error(`[AI-CALLBACK] Invalid callback data`, { request_id, status, output });
        return res.status(400).json({ error: 'Invalid callback data' });
    }

    if (status === 'error') {
        console.error(`[AI-CALLBACK] AI generation error`, { request_id, result });
        return res.status(500).json({ error: 'AI generation failed' });
    }

    try {
        console.log(`[AI-CALLBACK] Looking up user by request_id`, { request_id });

        const { data: userData, error } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('request_id', request_id)
            .single();

        if (error || !userData) {
            console.error(`[AI-CALLBACK] User lookup failed`, { request_id, error: error?.message });
            return res.status(500).json({ error: 'AI generation failed' });
        }

        console.log(`[AI-CALLBACK] User found`, { userId: userData.id, username: userData.username });

        const payload = {
            user_id: userData.id,
            username: userData.username || null,
            date: new Date().toISOString().split('T')[0], // Current date 'YYYY-MM-DD'
            text: output
        };

        console.log(`[AI-CALLBACK] Upserting diary entry`, { userId: payload.user_id, date: payload.date });

        const { data: diaryEntry, error: diaryError } = await supabaseAdmin
            .from('diary_entries')
            .upsert(payload)
            .select()
            .single();

        if (diaryError) {
            console.error(`[AI-CALLBACK] Diary entry upsert failed`, { error: diaryError.message, payload });
            return res.status(500).json({ error: diaryError.message });
        }

        console.log(`[AI-CALLBACK] Diary entry saved successfully`, { entryId: diaryEntry.id, userId: payload.user_id });

        // Trigger notification function
        // const notifyBody = {
        //     username: data.username || 'Someone',
        //     userId: data.userid,
        //     type: 'entry',
        //     date: data.date,
        //     entryId: data.id
        // };

        // await fetch(`${process.env.SUPABASE_URL}/functions/v1/send-notification`, {
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //         // If your function expects auth, send a key:
        //         Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        //     },
        //     body: JSON.stringify(notifyBody),
        // });
    } catch (e) {
        console.error(`[AI-CALLBACK] Error`, { error: e.message, stack: e.stack });
        return res.status(500).json({ error: e.message });
    }

    console.log(`[AI-CALLBACK] Callback completed successfully`, { request_id });
    return res.status(200).json({ success: true });
}