# Account Deletion Setup Guide

## Deploy the Edge Function

1. **Install Supabase CLI** (if not already installed):
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase**:
   ```bash
   supabase login
   ```

3. **Link your project**:
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```
   
   Find your project ref in your Supabase dashboard URL: `https://app.supabase.com/project/YOUR_PROJECT_REF`

4. **Deploy the function**:
   ```bash
   supabase functions deploy delete-account
   ```

## Test the Function

Test in your browser console while logged in:
```javascript
const { data: { session } } = await supabase.auth.getSession();
const response = await fetch('YOUR_SUPABASE_URL/functions/v1/delete-account', {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
    }
});
console.log(await response.json());
```

## What the Function Does

1. Verifies user authentication
2. Deletes all diary entries for the user
3. Deletes all images from storage
4. Deletes push notification subscriptions
5. Permanently deletes the user account from Supabase Auth

## Security

- Uses service role key (server-side only)
- Validates user authentication before deletion
- Only deletes data belonging to the authenticated user
