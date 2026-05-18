# Fix for Render Memory Crash on Audio Downloads

## Problem
Render free tier has only 512MB RAM. When downloading listening tests with base64 audio conversion, the server runs out of memory and crashes.

## Solution
Added an environment variable to disable base64 conversion on Render while keeping it enabled on Oracle (which has 1GB RAM).

## How to Fix on Render

### Step 1: Add Environment Variable

1. Go to Render Dashboard: https://dashboard.render.com
2. Click on your `ielts-platform` service
3. Go to **Environment** tab
4. Click **Add Environment Variable**
5. Add:
   - **Key:** `DISABLE_AUDIO_BASE64`
   - **Value:** `true`
6. Click **Save Changes**

### Step 2: Redeploy

Render will automatically redeploy with the new environment variable.

## What This Does

**On Render (with DISABLE_AUDIO_BASE64=true):**
- Downloaded listening tests will have audio URLs (not base64)
- Students need internet to play audio
- No memory crashes
- File size is small

**On Oracle (without this variable):**
- Downloaded listening tests have embedded base64 audio
- Works completely offline
- Larger file size (~10-20MB)
- Better for students with limited internet

## Testing

After deploying on Render:
1. Login to your Render site
2. Go to a listening test
3. Click download
4. Should download successfully without crashing
5. Open the HTML file - audio will stream from B2 (needs internet)

## Alternative: Upgrade Render

If you want offline audio on Render too:
- Upgrade to Render paid plan ($7/month)
- Get 512MB → 2GB RAM
- Remove the `DISABLE_AUDIO_BASE64` variable
- Base64 conversion will work without crashes
