-- Add is_edited and edit_date columns to diary_entries table
ALTER TABLE diary_entries 
ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS edit_date TIMESTAMP WITH TIME ZONE;

-- Update existing rows: if updated_at != created_at, mark as edited
UPDATE diary_entries 
SET is_edited = TRUE, edit_date = updated_at
WHERE updated_at != created_at AND is_edited = FALSE;

-- Create index for faster filtering by edit status
CREATE INDEX IF NOT EXISTS idx_diary_entries_is_edited ON diary_entries(is_edited);