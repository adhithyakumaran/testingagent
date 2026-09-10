"use client";

import { SettingsPanel } from "@/components/settings-panel";
import { UatCredentialsPanel } from "@/components/uat-credentials-panel";

export function ConnectorsView() {
  return (
    <div className="connectors-view">
      <div className="view-header">
        <div>
          <h2 className="view-title">Connectors</h2>
          <p className="view-subtitle">Credentials, channels, and integrations</p>
        </div>
      </div>
      <UatCredentialsPanel />
      <div className="conn-grid">
        {[
          ["Email", "Scheduled digest & report delivery"],
          ["WhatsApp", "Run alerts & failure notifications"],
          ["Slack", "Team channel routing"],
          ["Jira", "Auto-file defects on failure"],
          ["Oracle / ORDS", "Read-only app metadata"],
          ["Confluence", "Report publishing"],
        ].map(([name, desc]) => (
          <div key={name} className="conn-card">
            <div className="conn-icon">{name.slice(0, 1)}</div>
            <div>
              <div className="conn-name">{name}</div>
              <div className="conn-desc">{desc}</div>
            </div>
          </div>
        ))}
      </div>
      <SettingsPanel />
    </div>
  );
}
