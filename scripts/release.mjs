import fs from 'node:fs';
import assert from 'node:assert/strict';
const config=fs.readFileSync('app.config.ts','utf8');
assert.ok(config.includes('android.permission.INTERNET')&&config.includes('blockedPermissions'));
assert.ok(config.includes('android:allowBackup')&&config.includes('"false"'));
const files=fs.readdirSync('src',{recursive:true}).filter(f=>/\.(ts|tsx)$/.test(f)&&!String(f).startsWith('types'));
for(const f of files){const text=fs.readFileSync('src/'+f,'utf8');assert.ok(!/from\s+["']@supabase|EXPO_PUBLIC_SUPABASE|\bfetch\s*\(|https?:\/\//.test(text),'Mobile source must stay offline: '+f);}
assert.ok(!fs.existsSync('src/app/(auth)'));
console.log('PASS offline source contract: no cloud client, network endpoints, HTTP requests or authentication routes; Android Internet and automatic backup blocked. APK permissions still need binary verification.');
