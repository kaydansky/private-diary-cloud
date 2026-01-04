import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, username, date, gender, prompt, outputLength } = req.body;

    if (!userId || !gender || !date || !prompt) {
        return res.status(400).json({ error: 'userId, date, gender and prompt are required' });
    }

    try {
        const model = 'deepseek-chat';
        const genderAddition = gender === 'male' ? ' Твой пол мужской.' : ' Твой пол женский.';
        const promptAddition = `. — Напиши ответ в разговорном стиле, не более ${outputLength} слов, от лица члена СНТ. Иногда делай грамматические ошибки или опечатки.${genderAddition}`;

        const response1 = await fetch('https://api.gen-api.ru/api/v1/networks/' + model, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + process.env.GEN_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                top_p: 0.6,
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

        const statusReply = await response1.json();

        if (statusReply.status === 'error' || !statusReply.request_id) {
            console.error('AI API Error:', statusReply);
            return res.status(500).json({ error: 'AI generation failed' });
        }

        // Wait for AI processing
        await delay(10000);

        const response2 = await fetch('https://api.gen-api.ru/api/v1/request/get/' + statusReply.request_id, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + process.env.GEN_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        const result = await response2.json();

        console.log('AI API Result:', result);

        if (result.status === 'failed') {
            console.error('AI API Error:', result);
            return res.status(500).json({ error: 'AI generation failed' });
        }

        const text = result.output;

        const { data, error } = await supabaseAdmin
            .from('diary_entries')
            .insert({
                user_id: userId,
                username: username || null,
                date,
                text,
            })
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({ error: error.message });
        }

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

        return res.status(200).json({ entry: data });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Internal server error' });
    }
}