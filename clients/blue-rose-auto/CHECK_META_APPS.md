# Blue Rose Auto — Meta App Audit

**Goal:** Find which of your Meta apps has the most permissions (or can request them) for smOS to operate fully.

---

## What smOS Needs (Ideal Permission Set)

For **full smOS functionality** across paid + organic:

### Required Scopes
- ✅ `ads_management` — create/read/update campaigns, adsets, ads
- ✅ `pages_read_user_content` — read FB Page comments, reactions, engagement
- ✅ `instagram_business_management` — manage IG accounts, read insights
- ✅ `page_events_app` — access pixel events (conversions)
- ✅ `business_management` — manage ad accounts, pages, pixels
- ✅ `read_insights` — read analytics across FB/IG
- ✅ `catalog_management` — manage product catalogs (DPA)

### Nice-to-Have
- 🟡 `whatsapp_business_management` — read WhatsApp messages (future)
- 🟡 `threads_manage` — Threads app management (future)

---

## Step 1: List Your Apps

**Go to:** https://developers.facebook.com/apps

**You'll see a list like:**
```
- App 1: "My Business App" (ID: 123456...)
- App 2: "smOS" (ID: 1287397140178220)
- App 3: "Old Test App" (ID: 987654...)
```

**Copy each App ID below:**

| App Name | App ID | Notes |
|---|---|---|
| (your app 1) | | |
| (your app 2) | | |
| (your app 3) | | |

---

## Step 2: Check Permissions for Each App

**For each app, go to:**
`https://developers.facebook.com/apps/{APP_ID}/roles/test-users/`

**Or the Scopes tab:**
`https://developers.facebook.com/apps/{APP_ID}/settings/basic`

Look for **"Requested Permissions"** or **"App Roles"** section.

**Record which permissions each app has:**

| App ID | Has ads_management | pages_read_user_content | instagram_business_mgmt | business_management | Status |
|---|---|---|---|---|---|
| | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | Active/Inactive |
| | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | Active/Inactive |

---

## Step 3: Check App Review Status

**For the top candidate app(s):**

Go to: `https://developers.facebook.com/apps/{APP_ID}/app-review`

Look for:
- ✅ **"In Development"** or **"Live"** status
- ✅ **Business verification** (required for advanced access)
- ✅ **Which permissions are approved** vs. in-review vs. rejected

---

## Step 4: Which App is Best for smOS?

**Rank by:**

1. **Most permissions already approved** (fewer re-requests)
2. **Live status** (not "In Development")
3. **Business verification complete**
4. **No permission rejections in history**

---

## Next Steps

Once you identify the best app:

1. **Paste the App ID here** (I'll update the plugin config)
2. **I'll generate a new OAuth authorization link** for that app
3. **We'll request any missing permissions** if needed
4. **Then proceed with campaign renaming + audit-creative**

**Ready?** Send over your top 3 app IDs and I'll analyze them.
