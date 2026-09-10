"use client";

import { SettingsPanel } from "@/components/settings-panel";

export function ConnectorsView() {
  return (
    <div className="connectors-view">
      <div className="section-head">
        <div className="section-title">Automation connectors</div>
      </div>
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
            <div className="conn-icon">⚡</div>
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
