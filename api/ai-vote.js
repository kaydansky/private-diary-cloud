import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    console.log(`[AI-VOTE] Request received`, { method: req.method, hasBody: !!req.body });

    if (req.method !== 'POST') {
        console.error(`[AI-VOTE] Invalid method`, { method: req.method });
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, username, prompt, pollId, options } = req.body;
    console.log(`[AI-VOTE] Processing request`, { userId, hasPrompt: !!prompt, username, pollId, hasOptions: !!options });

    if (!userId || !prompt || !pollId || !options) {
        console.error(`[AI-VOTE] Missing required fields`, { userId, hasPrompt: !!prompt, pollId, hasOptions: !!options });
        return res.status(400).json({ error: 'userId, prompt, pollId and options are required' });
    }

    // Format options for AI prompt
    const optionsText = options.map((opt, idx) => `${idx + 1}. [ID: ${opt.id}] ${opt.text}`).join('\n');
    const finalPrompt = `Вопрос: ${prompt}\n\nВарианты ответа:\n${optionsText}\n\nВыбери один вариант ответа и верни только его ID.`;

    try {
        const models = ['chat-gpt-3', 'deepseek-chat', 'gpt-4o-mini'];
        const model = models[Math.floor(Math.random() * models.length)]; 
        const system = 'Проанализируй вопрос, выбери один из вариантов ответа и верни ID выбранного варианта. Твой ответ должен быть только ID, без другого текста.';

        console.log(`[AI-VOTE] Calling AI API`, { model, promptLength: finalPrompt.length });

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
                callback_url: 'https://private-diary-cloud.vercel.app/api/ai-vote-callback.js',
                messages: [
                    {
                        role: 'system',
                        content: [
                            {
                                text: system,
                                type: 'text'
                            } 
                        ]
                    },
                    { 
                        role: 'user', 
                        content: [
                            {
                                text: finalPrompt,
                                type: 'text'
                            }
                        ]
                    }
                ]
            })
        });

        const statusReply = await response.json();
        console.log('AI API Status:', statusReply);
        console.log(`[AI-VOTE] AI API response`, { status: statusReply.status, requestId: statusReply.request_id });

        if (statusReply.status === 'error' || !statusReply.request_id) {
            console.error('AI API Error:', statusReply);
            console.error(`[AI-VOTE] AI API error`, { error: statusReply });
            return res.status(500).json({ error: 'AI voting failed' });
        }

        console.log(`[AI-VOTE] Updating user with poll_request_id`, { userId, requestId: statusReply.request_id, pollId });

        const { error } = await supabaseAdmin
            .from('users')
            .update({poll_request_id: statusReply.request_id, poll_id: pollId})
            .eq('id', userId);

        if (error) {
            console.error(error);
            console.error(`[AI-VOTE] User update failed`, { userId, error: error.message });
            return res.status(500).json({ error: error.message });
        }

        console.log(`[AI-VOTE] Request queued successfully`, { userId, requestId: statusReply.request_id });
        return res.status(200).json({ request_id: statusReply.request_id });
    } catch (e) {
        console.error(e);
        console.error(`[AI-VOTE] Handler error`, { error: e.message, stack: e.stack });
        return res.status(500).json({ error: 'Internal server error' });
    }
}