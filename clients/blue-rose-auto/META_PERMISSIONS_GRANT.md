# Blue Rose Auto — Meta Permission Grant Flow

**Date:** 2026-08-04  
**App ID:** 1287397140178220  
**Ad Account:** act_1999616770762846  
**Status:** Permissions pending

---

## What You're Authorizing

Two permissions are required to unlock engagement metrics and full Instagram management:

| Permission | Purpose | Impact |
|---|---|---|
| `pages_read_user_content` | Read Facebook Page engagement metrics (comments, reactions, posts) | Enables `/audit` to pull FB post insights + engagement data |
| `instagram_business_management` | Manage Instagram Business Account | Enables Instagram follower insights + story/reel analytics |

---

## Step 1: Click the Authorization Link

**Copy and paste this URL into your browser:**

```
https://www.facebook.com/oauth/authorize?client_id=1287397140178220&scope=pages_read_user_content,instagram_business_management&redirect_uri=http://localhost:3000/callback&response_type=code&state=blue_rose_auto_perm_grant
```

**Or visit:** https://developers.facebook.com/apps/1287397140178220/settings/basic (via the Meta App Dashboard)

---

## Step 2: Authorize the App

1. You'll be redirected to Meta's login screen (if not already logged in)
2. Select the **Blue Rose Auto Facebook Page** and **Instagram Business Account**
3. Click **"Confirm"** to grant both permissions

---

## Step 3: Verify Permissions (Auto)

Once authorized, I'll use the **Meta devtools MCP** to verify:

```bash
# I'll run this to confirm both permissions are live:
devtools get_app_settings(app_id=1287397140178220)
```

---

## After Authorization

Once verified, you can:

1. ✅ Run `/audit` → pulls FB engagement metrics + IG insights
2. ✅ Run `/audit-creative` → reviews posts with full context (likes, comments, shares)
3. ✅ Rename the 4 campaigns to naming convention
4. ✅ Launch performance campaigns with full analytics

---

## Back-Channel (If OAuth redirect fails)

If the `localhost:3000/callback` redirect doesn't work:

1. You'll still see a **code** in the final URL: `...&code=ABC123...`
2. Paste that code here, and I'll exchange it for an access token
3. The devtools will verify the permissions are live

---

**Ready?** Authorize when you're set, then let me know. I'll verify with devtools and we move to renaming the 4 campaigns.
