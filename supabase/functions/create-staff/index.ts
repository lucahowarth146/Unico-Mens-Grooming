// create-staff: lets the shop owner create barber logins and change emails or passwords.
//
//   Create: { email, password, barber_id }
//   Update: { action: "update", user_id, email?, password?, barber_id? }
//
// Only a signed-in owner can call it. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are provided automatically by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Errors go back as 200 + {error} so the admin page can show the message.
const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST" });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(token);
  if (!who?.user) return reply({ error: "Sign in as the owner first." });
  const { data: me } = await db.from("admin_users").select("role").eq("user_id", who.user.id).maybeSingle();
  if (me?.role !== "owner") return reply({ error: "Only the owner can manage staff logins." });

  let b: Record<string, string> = {};
  try { b = await req.json(); } catch { return reply({ error: "Bad request" }); }
  const email = (b.email ?? "").trim().toLowerCase();
  const password = b.password ?? "";
  if (password && password.length < 8) return reply({ error: "Passwords need at least 8 characters." });

  if (b.action === "update") {
    if (!b.user_id) return reply({ error: "Missing user_id" });
    const { data: target } = await db.from("admin_users").select("role").eq("user_id", b.user_id).maybeSingle();
    if (!target) return reply({ error: "That login wasn't found." });
    const changes: Record<string, unknown> = {};
    if (email) { changes.email = email; changes.email_confirm = true; }
    if (password) changes.password = password;
    if (Object.keys(changes).length) {
      const { error } = await db.auth.admin.updateUserById(b.user_id, changes);
      if (error) return reply({ error: error.message.includes("already") ? "Another login already uses that email." : error.message });
    }
    const row: Record<string, unknown> = {};
    if (email) row.email = email;
    if (target.role === "staff" && b.barber_id) row.barber_id = b.barber_id;
    if (Object.keys(row).length) await db.from("admin_users").update(row).eq("user_id", b.user_id);
    return reply({ ok: true });
  }

  if (!email.includes("@") || !password || !b.barber_id) return reply({ error: "Enter an email, a password of at least 8 characters, and choose the barber." });
  const { data: made, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !made.user) return reply({ error: error?.message.includes("already") ? "That email already has a login." : (error?.message ?? "The login couldn't be created.") });
  const { error: e2 } = await db.from("admin_users").insert({ user_id: made.user.id, email, role: "staff", barber_id: b.barber_id });
  if (e2) { await db.auth.admin.deleteUser(made.user.id); return reply({ error: "The login couldn't be linked to that barber." }); }
  return reply({ ok: true, user_id: made.user.id });
});
