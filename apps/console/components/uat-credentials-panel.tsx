"use client";

import { useEffect, useState } from "react";
import { KeyRound, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Creds = {
  baseUrl: string;
  loginUrl: string;
  username: string;
  passwordSet: boolean;
  useSystemChrome: boolean;
  headless: boolean;
};

export function UatCredentialsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [loginUrl, setLoginUrl] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [useSystemChrome, setUseSystemChrome] = useState(true);

  useEffect(() => {
    fetch("/api/credentials")
      .then((r) => r.json())
      .then((json) => {
        const c = json.credentials as Creds;
        setBaseUrl(c.baseUrl || "");
        setLoginUrl(c.loginUrl || "login");
        setUsername(c.username || "");
        setUseSystemChrome(c.useSystemChrome !== false);
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          loginUrl,
          username,
          password: password || undefined,
          useSystemChrome,
          headless: false,
        }),
      });
      setPassword("");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="conn-card">Loading UAT credentials…</div>;

  return (
    <section className="conn-card conn-card-wide">
      <div className="conn-card-head">
        <KeyRound size={18} />
        <div>
          <div className="conn-name">UAT credentials</div>
          <div className="conn-desc">Saved to apps/automation/config/.env — used by Playwright login flows</div>
        </div>
      </div>
      <div className="cred-grid">
        <label className="cred-field">
          <span>Base URL</span>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://dev-ea.../ea" />
        </label>
        <label className="cred-field">
          <span>Login path</span>
          <Input value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} placeholder="login" />
        </label>
        <label className="cred-field">
          <span>Username</span>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="store user" autoComplete="off" />
        </label>
        <label className="cred-field">
          <span>Password {saved ? "" : "(leave blank to keep current)"}</span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </label>
      </div>
      <div className="cred-actions">
        <label className="cred-toggle">
          <input type="checkbox" checked={useSystemChrome} onChange={(e) => setUseSystemChrome(e.target.checked)} />
          Use system Chrome (recommended for UAT WAF)
        </label>
        <Button className="chat-cta primary" disabled={saving} onClick={() => void save()}>
          <Save size={14} />
          {saving ? "Saving…" : saved ? "Saved" : "Save credentials"}
        </Button>
      </div>
    </section>
  );
}
