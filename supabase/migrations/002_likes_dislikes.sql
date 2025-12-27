-- Create likes_dislikes table
CREATE TABLE IF NOT EXISTS likes_dislikes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    entry_id UUID REFERENCES diary_entries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    is_like BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entry_id, user_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_likes_dislikes_entry ON likes_dislikes(entry_id);
CREATE INDEX IF NOT EXISTS idx_likes_dislikes_user ON likes_dislikes(user_id);

-- Enable RLS
ALTER TABLE likes_dislikes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can manage their own likes/dislikes
CREATE POLICY "Users can manage their own likes/dislikes" ON likes_dislikes
    FOR ALL USING (auth.uid() = user_id);

-- Policy: Users can view likes/dislikes for entries
CREATE POLICY "Users can view likes/dislikes for entries" ON likes_dislikes
    FOR SELECT USING (true);

-- Create function to get like/dislike counts for entries
CREATE OR REPLACE FUNCTION get_like_dislike_counts(entry_ids UUID[])
RETURNS TABLE (
    entry_id UUID,
    likes_count BIGINT,
    dislikes_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ld.entry_id,
        COUNT(CASE WHEN ld.is_like THEN 1 END) AS likes_count,
        COUNT(CASE WHEN NOT ld.is_like THEN 1 END) AS dislikes_count
    FROM likes_dislikes ld
    WHERE ld.entry_id = ANY(entry_ids)
    GROUP BY ld.entry_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to get user's like/dislike status for entries
CREATE OR REPLACE FUNCTION get_user_like_dislike_status(entry_ids UUID[])
RETURNS TABLE (
    entry_id UUID,
    is_like BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ld.entry_id,
        ld.is_like
    FROM likes_dislikes ld
    WHERE ld.entry_id = ANY(entry_ids)
    AND ld.user_id = auth.uid();
END;
$$ LANGUAGE plpgsql;