# Supabase setup — Phase 1

This is a one-time setup so the app can store its data online (Supabase) instead of in a local file.

## Your project
- URL: `https://vecaqehmgssrihrymcec.supabase.co`
- Publishable key: `sb_publishable_-PX3RIoQ4JWttTUcnLTnaA_jC3FGa_4`

These are already wired into [src/main/supabaseClient.ts](src/main/supabaseClient.ts).

## What you need to do — in order

### 1. Install the new dependencies

In the project folder, run:

```
npm install
```

This installs `@supabase/supabase-js` and `ws` (added to `package.json`).

### 2. Create the tables in Supabase

1. Open https://supabase.com/dashboard/project/vecaqehmgssrihrymcec
2. Left sidebar → **SQL Editor** → **New query**
3. Open [supabase/schema.sql](supabase/schema.sql) in this repo. Copy the **contents** of the file (not the path).
4. Paste into the SQL editor, click **Run**.
5. Expected result: "Success. No rows returned."

Verify in **Table Editor** — you should see 8 tables:
`suppliers`, `raw_materials`, `components`, `products`, `stock_snapshots`, `production_plans`, `shortage_reports`, `email_batches`.

### 3. Lock down sign-up (recommended)

1. Left sidebar → **Authentication** → **Providers** → **Email**
2. Turn **OFF** "Enable Sign Ups"
3. **Save**

You'll create accounts manually in step 4.

### 4. Create user accounts

For each person who needs access:

1. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**
2. Enter email + temporary password
3. **Auto Confirm User**: ON
4. **Create user**

### 5. Confirm it builds

```
npm run build:main
```

If it builds with no errors, Phase 1 is done. The Supabase client is ready, but `database.ts` still uses the local file — nothing changes for end users yet.

## What's next — Phase 2

Once you confirm steps 1–5 are done, I'll:

1. Rewrite `src/main/database.ts` on Supabase (all methods become async)
2. Add a login screen (shown on first launch / when session expires)
3. Add a one-time "Migrate local data → cloud" button so existing suppliers / raw materials / components / products / plans / snapshots / reports / email batches come along
4. Update IPC handlers + services (`costCalculator`, `shortageCalculator`, `reverseCalculator`, `rfqGenerator`, `demoSeed`) to `await` the now-async DB methods

Bigger change than Phase 1 — we'll do it once Phase 1 is verified.
