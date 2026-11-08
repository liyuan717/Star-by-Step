import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import { localStatus } from "./local-status.mjs";
const { url, publicKey, serviceKey } = localStatus();
const mail = process.env.LOCAL_MAIL_URL || "http://127.0.0.1:54324";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(mail).hostname));
const auth = createClient(url, publicKey, {
  auth: { flowType: "pkce", persistSession: false, autoRefreshToken: false },
});
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `email-${randomUUID()}@local.invalid`,
  password = randomUUID() + "Aa1!";
const readMessages = new Set();
let userId;
async function consumeMail() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = await (await fetch(mail + "/api/v1/messages")).json();
    const message = (list.messages || list.items || []).find(
      (m) =>
        !readMessages.has(m.ID || m.id) &&
        JSON.stringify(m.To || m.to).includes(email),
    );
    if (message) {
      const id = message.ID || message.id;
      readMessages.add(id);
      const full = await (await fetch(mail + "/api/v1/message/" + id)).json();
      const text = (full.Text || "") + " " + (full.HTML || "");
      const match = text
        .replaceAll("&amp;", "&")
        .match(/https?:\/\/[^\s"<>]+\/auth\/v1\/verify\?[^\s"<>]+/);
      assert.ok(match, "Verification link missing from local test email");
      const link = new URL(match[0]);
      assert.equal(link.hostname, "127.0.0.1");
      const localLink = new URL(link.pathname + link.search, url);
      const response = await fetch(localLink, { redirect: "manual" });
      const location = response.headers.get("location");
      assert.ok(location, "Auth verification did not redirect");
      const code = new URL(location).searchParams.get("code");
      assert.ok(code, "Auth verification did not return PKCE code");
      const exchange = await auth.auth.exchangeCodeForSession(code);
      assert.ifError(exchange.error);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw Error("Local verification email did not arrive");
}
try {
  const signup = await auth.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: "energyworld://auth/callback" },
  });
  assert.ifError(signup.error);
  userId = signup.data.user.id;
  assert.equal(signup.data.session, null);
  await consumeMail();
  const verified = await auth.auth.getUser();
  assert.ifError(verified.error);
  assert.ok(verified.data.user.email_confirmed_at);
  console.log(
    "PASS public signup -> local verification email -> PKCE code exchange",
  );
  const reset = await auth.auth.resetPasswordForEmail(email, {
    redirectTo: "energyworld://reset-password",
  });
  assert.ifError(reset.error);
  await consumeMail();
  const next = randomUUID() + "Bb2!";
  const changed = await auth.auth.updateUser({ password: next });
  assert.ifError(changed.error);
  await auth.auth.signOut();
  assert.ok((await auth.auth.signInWithPassword({ email, password })).error);
  assert.ifError(
    (await auth.auth.signInWithPassword({ email, password: next })).error,
  );
  console.log(
    "PASS recovery email -> PKCE -> password update -> new password login",
  );
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  for (const id of readMessages)
    await fetch(mail + "/api/v1/messages/" + id, { method: "DELETE" }).catch(
      () => {},
    );
}
