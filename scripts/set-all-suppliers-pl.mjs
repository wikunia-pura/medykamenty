#!/usr/bin/env node
// Jednorazowy skrypt: ustawia preferredEmailLanguage = 'pl' u wszystkich dostawców.
// Uruchomienie:
//   node scripts/set-all-suppliers-pl.mjs
// Zapyta o email i hasło do konta Supabase aplikacji.

import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import WebSocket from 'ws';

// Node 20 nie ma globalnego WebSocket; supabase-realtime inicjalizuje się eagerly.
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket;

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://vecaqehmgssrihrymcec.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_-PX3RIoQ4JWttTUcnLTnaA_jC3FGa_4';

function prompt(question, { silent = false } = {}) {
  return new Promise(resolve => {
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!silent || chunk.toString().includes('\n')) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output: mutableStdout, terminal: true });
    rl.question(question, answer => {
      rl.close();
      if (silent) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const email = process.env.SUPABASE_EMAIL ?? (await prompt('Email: '));
  const password = process.env.SUPABASE_PASSWORD ?? (await prompt('Hasło: ', { silent: true }));

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    console.error(`Logowanie nieudane: ${signInError.message}`);
    process.exit(1);
  }
  console.log('Zalogowano.');

  const { data: rows, error: listError } = await supabase.from('suppliers').select('id, data');
  if (listError) {
    console.error(`Pobranie dostawców nieudane: ${listError.message}`);
    process.exit(1);
  }
  console.log(`Pobrano ${rows.length} dostawców.`);

  let changed = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const data = row.data ?? {};
    if (data.preferredEmailLanguage === 'pl') {
      skipped += 1;
      continue;
    }
    const newData = { ...data, preferredEmailLanguage: 'pl', updatedAt: now };
    const { error: updError } = await supabase
      .from('suppliers')
      .update({ data: newData, updated_at: now })
      .eq('id', row.id);
    if (updError) {
      console.error(`  ✗ ${data.name ?? row.id}: ${updError.message}`);
      continue;
    }
    console.log(`  ✓ ${data.name ?? row.id}`);
    changed += 1;
  }

  console.log(`\nZmieniono: ${changed}  Bez zmian: ${skipped}  Łącznie: ${rows.length}`);
  await supabase.auth.signOut();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
