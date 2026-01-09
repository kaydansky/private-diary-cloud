import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    console.log(`[AI-REPLY] Request received`, { method: req.method, hasBody: !!req.body });

    if (req.method !== 'POST') {
        console.error(`[AI-REPLY] Invalid method`, { method: req.method });
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, username, gender, prompt, starterUsername, starterEntryId } = req.body;
    const outputLength = Math.floor(Math.random() * (100 - 40 + 1)) + 40;

    console.log(`[AI-REPLY] Processing request`, { userId, gender, hasPrompt: !!prompt, outputLength, starterUsername, starterEntryId });

    if (!userId || !gender || !prompt) {
        console.error(`[AI-REPLY] Missing required fields`, { userId, gender, hasPrompt: !!prompt });
        return res.status(400).json({ error: 'userId, gender and prompt are required' });
    }

    try {
        const { data: userData, userError } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (userError || !userData) {
            console.error(`[AI-REPLY] User lookup failed`, { userId, error: userError?.message });
            return res.status(500).json({ error: 'User not found' });
        }

        const modelId = userData.ai_model_id;
        const model =  userData.ai_model;

        if (!modelId || !model) {
            console.error(`[AI-REPLY] AI model or model IDs not configured`, { userId, ai_model_id: userData.ai_model_id, ai_model: userData.ai_model });
            return res.status(500).json({ error: 'AI model not configured' });
        }

        console.log(`[AI-REPLY] Processing with modelId, model`, { modelId, model });

        const genderAddition = gender === 'male' ? ' Твой пол мужской.' : ' Твой пол женский.';
        let system = `Напиши ответ в разговорном стиле, не более ${outputLength} слов, от лица члена СНТ.${genderAddition}`;
        system += starterUsername ? ` Избегай обращаться к автору этого промпта по имени ${starterUsername}, только если есть нобходимость быть убедительным.` : '';
        system += username === 'Алексей' ? ' Отвечай в шутливой манере.' : '';
        system += username === 'Лежана Раздвиногова' ? ' Отвечай в наглой манере.' : '';
        system += ' Если спросили, кто ты, откуда ты и тому подобное, то уклоняйся от ответа, можно в шутливой манере.';
        system += ' Не выдумывай несуществующие факты и события. Выдай полезную, точную, релевантную информацию, особенно если задан вопрос.';
        system += ' Не используй слово "Ой".'
        const finalPrompt = prompt;

        console.log(`[AI-REPLY] Calling AI API`, { model, prompt: finalPrompt, outputLength });

        const response = await fetch('https://api.gen-api.ru/api/v1/networks/' + modelId, {
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
        console.log(`[AI-REPLY] AI API response`, { status: statusReply.status, requestId: statusReply.request_id });

        if (statusReply.status === 'error' || !statusReply.request_id) {
            console.error('AI API Error:', statusReply);
            console.error(`[AI-REPLY] AI API error`, { error: statusReply });
            return res.status(500).json({ error: 'AI generation failed' });
        }

        console.log(`[AI-REPLY] Updating user with request_id`, { userId, requestId: statusReply.request_id });

        const { error } = await supabaseAdmin
            .from('users')
            .update({request_id: statusReply.request_id})
            .eq('id', userId);

        if (error) {
            console.error(error);
            console.error(`[AI-REPLY] User update failed`, { userId, error: error.message });
            return res.status(500).json({ error: error.message });
        }

        console.log(`[AI-REPLY] Request queued successfully`, { userId, requestId: statusReply.request_id });
        return res.status(200).json({ request_id: statusReply.request_id });
    } catch (e) {
        console.error(e);
        console.error(`[AI-REPLY] Handler error`, { error: e.message, stack: e.stack });
        return res.status(500).json({ error: 'Internal server error' });
    }
}