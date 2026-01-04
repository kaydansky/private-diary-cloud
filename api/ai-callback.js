import { createClient } from '@supabase/supabase-js';
import { appendFile } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = process.env.LOG_FILE_PATH || `${__dirname}/../logs/ai-callback.log`;

async function logToFile(message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}${data ? ` ${JSON.stringify(data)}` : ''}\n`;
    try {
        await appendFile(LOG_FILE, logEntry);
    } catch (err) {
        console.error('Failed to write to log file:', err);
    }
}

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    const { request_id, status, output, result } = req.body;

    await logToFile('AI callback received', { request_id, status, hasOutput: !!output });

    if (status !== 'success' || !request_id || !output) {
        await logToFile('Invalid callback data', { request_id, status, output });
        return res.status(400).json({ error: 'Invalid callback data' });
    }

    if (status === 'error') {
        await logToFile('AI generation error', { request_id, result });
        return res.status(500).json({ error: 'AI generation failed' });
    }

    try {
        await logToFile('Looking up user by request_id', { request_id });

        const { data: userData, error } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('request_id', request_id)
            .single();

        if (error || !userData) {
            await logToFile('User lookup failed', { request_id, error: error?.message });
            return res.status(500).json({ error: 'AI generation failed' });
        }

        await logToFile('User found', { userId: userData.id, username: userData.username });

        const payload = {
            user_id: userData.id,
            username: userData.username || null,
            date: new Date().toISOString().split('T')[0], // Current date 'YYYY-MM-DD'
            text: output
        };

        await logToFile('Upserting diary entry', { userId: payload.user_id, date: payload.date });

        const { data: diaryEntry, error: diaryError } = await supabaseAdmin
            .from('diary_entries')
            .upsert(payload)
            .select()
            .single();

        if (diaryError) {
            await logToFile('Diary entry upsert failed', { error: diaryError.message, payload });
            return res.status(500).json({ error: diaryError.message });
        }

        await logToFile('Diary entry saved successfully', { entryId: diaryEntry.id, userId: payload.user_id });

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
        await logToFile('Callback error', { error: e.message, stack: e.stack });
        return res.status(500).json({ error: e.message });
    }

    await logToFile('Callback completed successfully', { request_id });
    return res.status(200).json({ success: true });
}