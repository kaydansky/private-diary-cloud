import { createClient } from '@supabase/supabase-js';
import { appendFile } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = process.env.LOG_FILE_PATH || `${__dirname}/../logs/ai-insert.log`;

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

// const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// await delay(10000);

export default async function handler(req, res) {
    await logToFile('AI insert request received', { method: req.method, hasBody: !!req.body });

    if (req.method !== 'POST') {
        await logToFile('Invalid method', { method: req.method });
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, gender, prompt, outputLength } = req.body;

    await logToFile('Processing request', { userId, gender, hasPrompt: !!prompt, outputLength });

    if (!userId || !gender || !prompt) {
        await logToFile('Missing required fields', { userId, gender, hasPrompt: !!prompt });
        return res.status(400).json({ error: 'userId, gender and prompt are required' });
    }

    try {
        const model = 'deepseek-chat';
        const genderAddition = gender === 'male' ? ' Твой пол мужской.' : ' Твой пол женский.';
        const promptAddition = `. — Напиши ответ в разговорном стиле, не более ${outputLength} слов, от лица члена СНТ. Иногда делай грамматические ошибки или опечатки.${genderAddition}`;

        await logToFile('Calling AI API', { model, promptLength: prompt.length, outputLength });

        const response = await fetch('https://api.gen-api.ru/api/v1/networks/' + model, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + process.env.GEN_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                top_p: 0.6,
                callback_url: 'https://snt-tishinka.ru/api/ai-callback.js',
                messages: [
                    { 
                        role: 'user', 
                        content: [
                            {
                                text: prompt + promptAddition,
                                type: 'text'
                            }
                        ]
                    }
                ]
            })
        });

        const statusReply = await response.json();
        console.log('AI API Status:', statusReply);
        await logToFile('AI API response', { status: statusReply.status, requestId: statusReply.request_id });

        if (statusReply.status === 'error' || !statusReply.request_id) {
            console.error('AI API Error:', statusReply);
            await logToFile('AI API error', { error: statusReply });
            return res.status(500).json({ error: 'AI generation failed' });
        }

        await logToFile('Updating user with request_id', { userId, requestId: statusReply.request_id });

        const { error } = await supabaseAdmin
            .from('users')
            .update({request_id: statusReply.request_id})
            .eq('id', userId);

        if (error) {
            console.error(error);
            await logToFile('User update failed', { userId, error: error.message });
            return res.status(500).json({ error: error.message });
        }

        await logToFile('Request queued successfully', { userId, requestId: statusReply.request_id });
        return res.status(200).json({ request_id: statusReply.request_id });
    } catch (e) {
        console.error(e);
        await logToFile('Handler error', { error: e.message, stack: e.stack });
        return res.status(500).json({ error: 'Internal server error' });
    }
}