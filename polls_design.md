# Polls Database Design

## Requirements Analysis

Based on the requirements, we need to store poll data with the following attributes:
- Record timestamp
- Question
- Options (variable number)
- Poll's creator user_id
- Number of votes per option
- User_id related to each vote
- Ability to show poll results including creator username, question, options, and vote counts
- Ability to retrieve voted users for each option

## Database Schema Design

After analyzing the requirements, a multi-table approach is recommended for better normalization and query performance:

### 1. polls Table
Stores the main poll information.

```sql
-- Create polls table
CREATE TABLE polls (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 2. poll_options Table
Stores the poll options. This allows for a variable number of options per poll.

```sql
-- Create poll_options table
CREATE TABLE poll_options (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3. poll_votes Table
Tracks individual votes to allow for retrieving which users voted for which options.

```sql
-- Create poll_votes table
CREATE TABLE poll_votes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
    option_id UUID REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(poll_id, user_id) -- Ensures a user can only vote once per poll
);
```

## Row Level Security (RLS) Policies

To maintain consistency with the existing security model, we need to add RLS policies:

```sql
-- Enable RLS
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

-- Policies for polls
CREATE POLICY "Everyone can read all polls"
ON public.polls
FOR SELECT
TO public
USING (true);

CREATE POLICY "Users can create their own polls"
ON public.polls
FOR INSERT
TO authenticated
WITH CHECK (user_id = (SELECT auth.uid() AS uid));

CREATE POLICY "Users can update their own polls"
ON public.polls
FOR UPDATE
TO authenticated
USING (user_id = (SELECT auth.uid() AS uid))
WITH CHECK (user_id = (SELECT auth.uid() AS uid));

CREATE POLICY "Users can delete their own polls"
ON public.polls
FOR DELETE
TO authenticated
USING (user_id = (SELECT auth.uid() AS uid));

-- Policies for poll_options (managed through polls)
CREATE POLICY "Everyone can read poll options"
ON public.poll_options
FOR SELECT
TO public
USING (true);

CREATE POLICY "Users can manage options for their polls"
ON public.poll_options
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM polls 
        WHERE polls.id = poll_options.poll_id 
        AND polls.user_id = (SELECT auth.uid() AS uid)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM polls 
        WHERE polls.id = poll_options.poll_id 
        AND polls.user_id = (SELECT auth.uid() AS uid)
    )
);

-- Policies for poll_votes
CREATE POLICY "Everyone can read poll votes"
ON public.poll_votes
FOR SELECT
TO public
USING (true);

CREATE POLICY "Users can vote on polls"
ON public.poll_votes
FOR INSERT
TO authenticated
WITH CHECK (user_id = (SELECT auth.uid() AS uid));

-- Users cannot change their vote, so no UPDATE policy
CREATE POLICY "Users can delete their own votes"
ON public.poll_votes
FOR DELETE
TO authenticated
USING (user_id = (SELECT auth.uid() AS uid));

-- RPC Function to get poll vote counts
CREATE OR REPLACE FUNCTION public.get_poll_vote_counts(poll_ids uuid[])
RETURNS TABLE (
  poll_id uuid,
  option_id uuid,
  vote_count bigint
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT pv.poll_id, pv.option_id, COUNT(*) AS vote_count
  FROM public.poll_votes pv
  WHERE pv.poll_id = ANY(poll_ids)
  GROUP BY pv.poll_id, pv.option_id
  ORDER BY pv.poll_id, pv.option_id;
$$;
```

## Indexes for Performance

```sql
-- Indexes for better query performance
CREATE INDEX idx_polls_user_id ON polls(user_id);
CREATE INDEX idx_poll_options_poll_id ON poll_options(poll_id);
CREATE INDEX idx_poll_votes_poll_id ON poll_votes(poll_id);
CREATE INDEX idx_poll_votes_option_id ON poll_votes(option_id);
CREATE INDEX idx_poll_votes_user_id ON poll_votes(user_id);
```

## Common Queries

### 1. Get poll with options and vote counts
```sql
SELECT 
    p.id,
    p.question,
    p.user_id,
    p.created_at,
    json_agg(
        json_build_object(
            'id', po.id,
            'option_text', po.option_text,
            'position', po.position,
            'vote_count', COALESCE(vote_counts.count, 0)
        ) ORDER BY po.position
    ) AS options
FROM polls p
JOIN poll_options po ON p.id = po.poll_id
LEFT JOIN (
    SELECT option_id, COUNT(*) as count
    FROM poll_votes
    GROUP BY option_id
) vote_counts ON po.id = vote_counts.option_id
WHERE p.id = 'poll_id_here'
GROUP BY p.id, p.question, p.user_id, p.created_at;
```

### 2. Get users who voted for a specific option
```sql
SELECT 
    u.id as user_id,
    u.raw_user_meta_data->>'username' as username
FROM poll_votes pv
JOIN auth.users u ON pv.user_id = u.id
WHERE pv.option_id = 'option_id_here';
```

### 3. Check if user has voted on a poll
```sql
SELECT EXISTS(
    SELECT 1 
    FROM poll_votes 
    WHERE poll_id = 'poll_id_here' 
    AND user_id = 'user_id_here'
) as has_voted;
```

## Design Decisions

1. **Multi-table approach**: Chosen for better normalization and flexibility
   - Allows for variable number of options per poll
   - Enables tracking of individual votes
   - Makes it easy to query vote counts and user information

2. **Vote tracking**: Individual votes are stored to allow:
   - Retrieving which users voted for which options
   - Preventing users from voting multiple times
   - Potential future features like changing votes

3. **Security**: Follows the same RLS pattern as the existing diary_entries table
   - Public read access for all poll data
   - Authenticated users can create polls
   - Users can only modify their own polls
   - Users can only vote for themselves

4. **Indexes**: Added for common query patterns to ensure good performance

This design provides a solid foundation for the poll feature while maintaining consistency with the existing application architecture.