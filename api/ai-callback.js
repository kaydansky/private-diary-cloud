import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// UUID validation regex
function isUUID(value) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
}

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
        console.log('[AI-CALLBACK] Looking up user by request_id:', JSON.stringify({ request_id }, null, 2));

        const { data: userData, error } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('request_id', request_id)
            .single();

        if (error || !userData) {
            // Check if this is a poll vote request (uses poll_request_id instead)
            console.log('[AI-CALLBACK] User not found by request_id, checking poll_request_id:', JSON.stringify({ request_id }, null, 2));

            const { data: pollUserData, pollError } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('poll_request_id', request_id)
                .single();

            if (pollError || !pollUserData) {
                console.error('[AI-CALLBACK] User lookup failed:', JSON.stringify({ request_id, error: pollError?.message }, null, 2));
                return res.status(500).json({ error: 'User not found' });
            }

            // Check if this is a poll vote request
            if (pollUserData.poll_id) {
                const selectedOptionId = reply;

                if (isUUID(selectedOptionId)) {
                    console.log('[AI-CALLBACK] Processing poll vote:', JSON.stringify({ pollId: pollUserData.poll_id, optionId: selectedOptionId, userId: pollUserData.id }, null, 2));

                    const { error: voteError } = await supabaseAdmin
                        .from('poll_votes')
                        .insert({
                            poll_id: pollUserData.poll_id,
                            option_id: selectedOptionId,
                            user_id: pollUserData.id
                        });

                    if (voteError) {
                        console.error('[AI-CALLBACK] Poll vote insert failed:', JSON.stringify({ error: voteError.message }, null, 2));
                        return res.status(500).json({ error: voteError.message });
                    }

                    console.log('[AI-CALLBACK] Poll vote inserted successfully:', JSON.stringify({ pollId: pollUserData.poll_id, optionId: selectedOptionId }, null, 2));

                    // Clear poll_request_id and poll_id from user
                    await supabaseAdmin
                        .from('users')
                        .update({ poll_request_id: null, poll_id: null })
                        .eq('id', pollUserData.id);

                    return res.status(200).json({ success: true, voteInserted: true });
                } else {
                    console.error('[AI-CALLBACK] Invalid UUID format in poll vote result:', JSON.stringify({ selectedOptionId }, null, 2));
                    return res.status(400).json({ error: 'Invalid option ID format' });
                }
            }

            console.error('[AI-CALLBACK] User found but no poll_id:', JSON.stringify({ request_id }, null, 2));
            return res.status(500).json({ error: 'Poll vote request not found' });
        }

        console.log('[AI-CALLBACK] User found:', JSON.stringify({ userId: userData.id, username: userData.username }, null, 2));

        // Check if this is a poll vote request
        if (userData.poll_id) {
            const selectedOptionId = reply;

            if (isUUID(selectedOptionId)) {
                console.log('[AI-CALLBACK] Processing poll vote:', JSON.stringify({ pollId: userData.poll_id, optionId: selectedOptionId, userId: userData.id }, null, 2));

                const { error: voteError } = await supabaseAdmin
                    .from('poll_votes')
                    .insert({
                        poll_id: userData.poll_id,
                        option_id: selectedOptionId,
                        user_id: userData.id
                    });

                if (voteError) {
                    console.error('[AI-CALLBACK] Poll vote insert failed:', JSON.stringify({ error: voteError.message }, null, 2));
                    return res.status(500).json({ error: voteError.message });
                }

                console.log('[AI-CALLBACK] Poll vote inserted successfully:', JSON.stringify({ pollId: userData.poll_id, optionId: selectedOptionId }, null, 2));

                // Clear poll_id from user and return (stop further execution)
                await supabaseAdmin
                    .from('users')
                    .update({ poll_id: null })
                    .eq('id', userData.id);

                return res.status(200).json({ success: true, voteInserted: true });
            } else {
                console.error('[AI-CALLBACK] Invalid UUID format in poll vote result:', JSON.stringify({ selectedOptionId }, null, 2));
                return res.status(400).json({ error: 'Invalid option ID format' });
            }
        }

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

        // Clear request_id from user after successful processing
        await supabaseAdmin
            .from('users')
            .update({ request_id: null })
            .eq('id', userData.id);
    } catch (e) {
        console.error('[AI-CALLBACK] Error:', JSON.stringify({ error: e.message, stack: e.stack }, null, 2));
        return res.status(500).json({ error: e.message });
    }

    console.log('[AI-CALLBACK] Callback completed successfully:', JSON.stringify({ request_id }, null, 2));
    return res.status(200).json({ success: true });
}