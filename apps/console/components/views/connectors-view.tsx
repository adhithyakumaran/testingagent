"use client";

import { SettingsPanel } from "@/components/settings-panel";
import { UatCredentialsPanel } from "@/components/uat-credentials-panel";

export function ConnectorsView() {
  return (
    <div className="connectors-view">
      <div className="view-header">
        <div>
          <h2 className="view-title">Connectors</h2>
          <p className="view-subtitle">UAT credentials and console settings — required before headed Playwright runs</p>
        </div>
      </div>
      <UatCredentialsPanel />
      <SettingsPanel />
    </div>
  );
}
