import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// await delay(10000);

export default async function handler(req, res) {
    console.log(`[AI-INSERT] Request received`, { method: req.method, hasBody: !!req.body });

    if (req.method !== 'POST') {
        console.error(`[AI-INSERT] Invalid method`, { method: req.method });
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, gender, prompt, outputLength, username } = req.body;

    console.log(`[AI-INSERT] Processing request`, { userId, gender, hasPrompt: !!prompt, outputLength });

    if (!userId || !gender || !prompt) {
        console.error(`[AI-INSERT] Missing required fields`, { userId, gender, hasPrompt: !!prompt });
        return res.status(400).json({ error: 'userId, gender and prompt are required' });
    }

    try {
        const { data: userData, userError } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (userError || !userData) {
            console.error(`[AI-INSERT] User lookup failed`, { userId, error: userError?.message });
            return res.status(500).json({ error: 'User not found' });
        }

        const model = userData.ai_model;

        if (!model) {
            console.error(`[AI-INSERT] AI model not configured`, { userId, ai_model: userData.ai_model });
            return res.status(500).json({ error: 'AI model not configured' });
        }

        console.log(`[AI-INSERT] Processing with model`, { model });

        const genderAddition = gender === 'male' ? ' Твой пол мужской.' : ' Твой пол женский.';
        let system = `Напиши ответ в разговорном стиле, не более ${outputLength} слов, от лица члена СНТ.${genderAddition}`;
        system += ' Не выдумывай несуществующие факты и события. Выдай полезную, точную, релевантную информацию, если задан вопрос.';
        system += username === 'Лежана Раздвиногова' ? ' Отвечай в наглой манере, но по теме промпта.' : '';
        system += ' Не используй слово "Ой".'
        
        console.log(`[AI-INSERT] Calling AI API`, { model, promptLength: prompt.length, outputLength });

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
                                text: prompt,
                                type: 'text'
                            }
                        ]
                    }
                ]
            })
        });

        const statusReply = await response.json();
        console.log('AI API Status:', statusReply);
        console.log(`[AI-INSERT] AI API response`, { status: statusReply.status, requestId: statusReply.request_id });

        if (statusReply.status === 'error' || !statusReply.request_id) {
            console.error('AI API Error:', statusReply);
            console.error(`[AI-INSERT] AI API error`, { error: statusReply });
            return res.status(500).json({ error: 'AI generation failed' });
        }

        console.log(`[AI-INSERT] Updating user with request_id`, { userId, requestId: statusReply.request_id });

        const { error } = await supabaseAdmin
            .from('users')
            .update({request_id: statusReply.request_id})
            .eq('id', userId);

        if (error) {
            console.error(error);
            console.error(`[AI-INSERT] User update failed`, { userId, error: error.message });
            return res.status(500).json({ error: error.message });
        }

        console.log(`[AI-INSERT] Request queued successfully`, { userId, requestId: statusReply.request_id });
        return res.status(200).json({ request_id: statusReply.request_id });
    } catch (e) {
        console.error(e);
        console.error(`[AI-INSERT] Handler error`, { error: e.message, stack: e.stack });
        return res.status(500).json({ error: 'Internal server error' });
    }
}