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
    console.log('[AI-VOTE-CALLBACK] Received callback:', JSON.stringify(req.body, null, 2));

    if (status !== 'success' || !request_id) {
        console.error('[AI-VOTE-CALLBACK] Invalid callback data:', JSON.stringify({ request_id, status, result }, null, 2));
        return res.status(400).json({ error: 'Invalid callback data' });
    }

    let reply = null;

    if (result[0].message?.content) {
        reply = result[0].message.content.trim();
    } else if (result[0].choices?.[0]?.message?.content) {
        reply = result[0].choices[0].message.content.trim();
    } else {
        console.error('[AI-VOTE-CALLBACK] No reply found:', JSON.stringify({ request_id, status, result }, null, 2));
        return res.status(400).json({ error: 'Invalid JSON parsing' });
    }

    if (status === 'error') {
        console.error('[AI-VOTE-CALLBACK] AI generation error:', JSON.stringify({ request_id, result }, null, 2));
        return res.status(500).json({ error: 'AI generation failed' });
    }

    try {
        console.log('[AI-VOTE-CALLBACK] Looking up user poll_request_id:', JSON.stringify({ request_id }, null, 2));

        // Try to find user by poll_request_id
        let userData = null;
        const { data: dataByPollRequestId, error: errorByPollRequestId } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('poll_request_id', request_id)
            .single();

        if (!errorByPollRequestId && dataByPollRequestId) {
            userData = dataByPollRequestId;
            console.log('[AI-VOTE-CALLBACK] User found by poll_request_id:', JSON.stringify({ userId: userData.id, username: userData.username }, null, 2));
        }

        if (!userData) {
            console.error('[AI-VOTE-CALLBACK] User lookup failed:', JSON.stringify({ request_id }, null, 2));
            return res.status(500).json({ error: 'User not found' });
        }

        // Process poll vote if poll_id exists
        if (userData.poll_id) {
            const selectedOptionId = reply;
            const extractedUUID = isUUID(selectedOptionId);

            if (extractedUUID) {
                // Valid UUID - process poll vote
                console.log('[AI-VOTE-CALLBACK] Processing poll vote:', JSON.stringify({ pollId: userData.poll_id, optionId: extractedUUID, userId: userData.id }, null, 2));

                const { error: voteError } = await supabaseAdmin
                    .from('poll_votes')
                    .insert({
                        poll_id: userData.poll_id,
                        option_id: extractedUUID,
                        user_id: userData.id
                    });

                if (voteError) {
                    console.error('[AI-VOTE-CALLBACK] Poll vote insert failed:', JSON.stringify({ error: voteError.message }, null, 2));
                    return res.status(500).json({ error: voteError.message });
                }

                console.log('[AI-VOTE-CALLBACK] Poll vote inserted successfully:', JSON.stringify({ pollId: userData.poll_id, optionId: extractedUUID }, null, 2));
            } else {
                // Invalid UUID from poll vote
                console.log('[AI-VOTE-CALLBACK] Invalid UUID in poll vote:', JSON.stringify({ selectedOptionId }, null, 2));
                return res.status(500).json({ error: 'Poll option UUID not found' });
            }
        } else {
            console.error('[AI-VOTE-CALLBACK] Poll ID not found:', JSON.stringify({ userData }, null, 2));
            return res.status(400).json({ error: 'Poll ID not found' });
        }

        // Cleanup: Clear processed request ID and poll ID fields
        await supabaseAdmin
            .from('users')
            .update({poll_request_id: null, poll_id: null})
            .eq('id', userData.id);
    } catch (e) {
        console.error('[AI-VOTE-CALLBACK] Error:', JSON.stringify({ error: e.message, stack: e.stack }, null, 2));
        return res.status(500).json({ error: e.message });
    }

    console.log('[AI-VOTE-CALLBACK] Vote callback completed successfully:', JSON.stringify({ request_id }, null, 2));
    return res.status(200).json({ success: true });
}