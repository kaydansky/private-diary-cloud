# Push Notifications Setup Guide

## Prerequisites
1. Supabase project with Edge Functions enabled
2. VAPID keys for Web Push

## Step 1: Generate VAPID Keys

Run this in your terminal:
```bash
npx web-push generate-vapid-keys
```

Save the output:
- Public Key: Add to `config.js` as `VAPID_PUBLIC_KEY`
- Private Key: Add to Supabase Edge Function secrets

## Step 2: Run Database Migration

In your Supabase SQL Editor, run:
```sql
-- Copy contents from supabase/migrations/001_push_notifications.sql
```

## Step 3: Deploy Edge Function

1. Install Supabase CLI: `npm install -g supabase`
2. Login: `supabase login`
3. Link project: `supabase link --project-ref YOUR_PROJECT_REF`
4. Set secrets:
```bash
supabase secrets set VAPID_PRIVATE_KEY="your-private-key"
supabase secrets set VAPID_PUBLIC_KEY="your-public-key"
```
5. Deploy: `supabase functions deploy send-notification`

## Step 4: Update config.js

Add your VAPID public key to `config.js`:
```javascript
const VAPID_PUBLIC_KEY = 'your-vapid-public-key';
```

## Step 5: Test

1. Open the app
2. Grant notification permission when prompted
3. Create a new entry
4. Other users should receive a push notification

## Troubleshooting

- **No permission prompt**: Check browser settings
- **Notifications not received**: Check service worker registration
- **iOS Safari**: Only works when app is added to home screen
