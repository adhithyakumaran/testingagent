"use client";

import { useEffect, useState } from "react";

type ApprovalItem = {
  flowId: string;
  status: string;
  scenarios: string;
  testCases: string;
};

export function ApprovalsView({ compact, onClose }: { compact?: boolean; onClose?: () => void }) {
  const [items, setItems] = useState<ApprovalItem[]>([]);

  useEffect(() => {
    fetch("/api/approval")
      .then((r) => r.json())
      .then((json) => setItems(json.flows || []))
      .catch(() => setItems([]));
  }, []);

  if (compact) {
    return (
      <>
        <div className="ap-head">
          <span>Pending SME approval</span>
          <span className="mono">{items.length}</span>
        </div>
        {items.slice(0, 2).map((item, i) => (
          <div key={`${item.flowId}-${i}`} className="ap-item">
            <div className="ap-item-title">{item.flowId}</div>
            <div className="ap-item-desc">
              {item.scenarios} scenarios · {item.testCases} test cases — review before @sanity CI promotion.
            </div>
            <div className="ap-actions">
              <button type="button" className="ap-btn approve" onClick={onClose}>
                Review
              </button>
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="approvals-view">
      <div className="section-head">
        <div className="section-title">SME approval queue</div>
      </div>
      <div className="run-list">
        {items.map((item, i) => (
          <div key={`${item.flowId}-${i}`} className="run-row">
            <div className="status-pill running">PENDING</div>
            <div className="run-name">{item.flowId}</div>
            <div className="run-meta">
              {item.scenarios} sc · {item.testCases} tc
            </div>
            <button type="button" className="chat-cta">
              Approve
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
