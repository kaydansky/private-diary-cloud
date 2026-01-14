import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// UUID extraction and validation
function isUUID(value) {
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = value.match(uuidRegex);
    return match ? match[0] : null;
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
        console.log('[AI-CALLBACK] Looking up user by request_id or poll_request_id:', JSON.stringify({ request_id }, null, 2));

        // Try to find user by request_id first, then by poll_request_id
        let userData = null;
        const { data: dataByRequestId, error: errorByRequestId } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('request_id', request_id)
            .single();

        if (!errorByRequestId && dataByRequestId) {
            userData = dataByRequestId;
            console.log('[AI-CALLBACK] User found by request_id:', JSON.stringify({ userId: userData.id, username: userData.username }, null, 2));
        } else {
            // Try poll_request_id as fallback
            const { data: dataByPollRequestId, error: errorByPollRequestId } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('poll_request_id', request_id)
                .single();

            if (!errorByPollRequestId && dataByPollRequestId) {
                userData = dataByPollRequestId;
                console.log('[AI-CALLBACK] User found by poll_request_id:', JSON.stringify({ userId: userData.id, username: userData.username }, null, 2));
            }
        }

        if (!userData) {
            console.error('[AI-CALLBACK] User lookup failed:', JSON.stringify({ request_id }, null, 2));
            return res.status(500).json({ error: 'User not found' });
        }

        let processedPollVote = false;

        // Priority 1: Process poll vote if poll_id exists
        if (userData.poll_id) {
            const selectedOptionId = reply;
            const extractedUUID = isUUID(selectedOptionId);

            if (extractedUUID) {
                // Valid UUID - process poll vote
                console.log('[AI-CALLBACK] Processing poll vote:', JSON.stringify({ pollId: userData.poll_id, optionId: extractedUUID, userId: userData.id }, null, 2));

                const { error: voteError } = await supabaseAdmin
                    .from('poll_votes')
                    .insert({
                        poll_id: userData.poll_id,
                        option_id: extractedUUID,
                        user_id: userData.id
                    });

                if (voteError) {
                    console.error('[AI-CALLBACK] Poll vote insert failed:', JSON.stringify({ error: voteError.message }, null, 2));
                    return res.status(500).json({ error: voteError.message });
                }

                console.log('[AI-CALLBACK] Poll vote inserted successfully:', JSON.stringify({ pollId: userData.poll_id, optionId: extractedUUID }, null, 2));
                processedPollVote = true;
            } else {
                // Invalid UUID from poll vote - don't return error, fall through to request_id processing
                console.log('[AI-CALLBACK] Invalid UUID in poll vote, will process diary entry via request_id instead:', JSON.stringify({ selectedOptionId }, null, 2));
            }
        }

        // Priority 2: Process diary entry if poll vote wasn't processed and request_id exists
        if (!processedPollVote && userData.request_id) {
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
        }

        // Cleanup: Clear processed request IDs and poll fields
        const updateFields = {};
        if (processedPollVote && userData.poll_id) {
            updateFields.poll_id = null;
        }
        if (userData.request_id) {
            updateFields.request_id = null;
        }
        if (userData.poll_request_id) {
            updateFields.poll_request_id = null;
        }

        if (Object.keys(updateFields).length > 0) {
            await supabaseAdmin
                .from('users')
                .update(updateFields)
                .eq('id', userData.id);
        }
    } catch (e) {
        console.error('[AI-CALLBACK] Error:', JSON.stringify({ error: e.message, stack: e.stack }, null, 2));
        return res.status(500).json({ error: e.message });
    }

    console.log('[AI-CALLBACK] Callback completed successfully:', JSON.stringify({ request_id }, null, 2));
    return res.status(200).json({ success: true });
}