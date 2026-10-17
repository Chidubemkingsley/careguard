"use client";

import { useState, useMemo } from "react";
import { downloadTransactionPDF, downloadAuditLogPDF } from "../../app/pdf";
import { copyText } from "../../lib/clipboard";
import type { RecipientProfile } from "../../lib/types";
import { ConfirmDialog } from "../primitives/confirm-dialog";
import { TxLink } from "../primitives/tx-link";
import { formatTime, type Locale } from "../../i18n";
import type {
  AgentLogEntry,
  PaginationData,
  SpendingData,
  Transaction,
  AuditLogEvent,
} from "../types";

export interface ActivityTabProps {
  recipient: RecipientProfile;
  agentLog: AgentLogEntry[];
  setAgentLog: (entries: AgentLogEntry[]) => void;
  allTransactions: Transaction[];
  auditEvents?: AuditLogEvent[];
  pagination: PaginationData | null;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  spending: SpendingData | null;
  onResetAgent: () => void;
  loadingTransactions?: boolean;
  loadingSpending?: boolean;
  // #1139 — defaults to "en" so existing callers that don't pass a locale
  // render identically to before this change.
  locale?: Locale;
}

export function ActivityTab({
  recipient,
  agentLog,
  setAgentLog,
  allTransactions,
  auditEvents = [],
  pagination,
  currentPage,
  setCurrentPage,
  pageSize,
  setPageSize,
  spending,
  onResetAgent,
  locale = "en",
}: ActivityTabProps) {
  const [showAllLogEntries, setShowAllLogEntries] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // allTransactions arrives pre-sorted newest-first from fetchTransactions (#220).
  // useMemo ensures the merge only reruns when transactions or audit events change,
  // not on unrelated parent state changes (agentLog, loading flags, etc.).
  const mergedTimeline = useMemo(() => {
    type TimelineItem = {
      ts: number;
      kind: "tx" | "audit";
      id: string;
      data: any;
    };
    const txItems: TimelineItem[] = allTransactions.map((tx) => ({
      kind: "tx",
      ts: new Date(tx.timestamp).getTime(),
      id: tx.id,
      data: tx,
    }));
    const auditItems: TimelineItem[] = auditEvents.map((au) => ({
      kind: "audit",
      ts: new Date(au.timestamp).getTime(),
      id: `audit-${au.timestamp}-${au.event}`,
      data: au,
    }));
    // Merge the two newest-first sequences. txItems is guaranteed pre-sorted;
    // auditItems are sorted here. A linear merge keeps this O(n) when both
    // inputs are already ordered.
    auditItems.sort((a, b) => b.ts - a.ts);
    const merged: TimelineItem[] = [];
    let ti = 0,
      ai = 0;
    while (ti < txItems.length && ai < auditItems.length) {
      if (txItems[ti].ts >= auditItems[ai].ts) merged.push(txItems[ti++]);
      else merged.push(auditItems[ai++]);
    }
    while (ti < txItems.length) merged.push(txItems[ti++]);
    while (ai < auditItems.length) merged.push(auditItems[ai++]);
    return merged;
  }, [allTransactions, auditEvents]);

  return (
    <div
      role="tabpanel"
      id="tabpanel-activity"
      aria-labelledby="tab-activity"
      tabIndex={0}
      className="space-y-4"
    >
      <ConfirmDialog
        open={confirmOpen}
        title="Reset all agent data?"
        description={`This will delete ${allTransactions.length} transaction${
          allTransactions.length === 1 ? "" : "s"
        }, the agent log, and all audit results. This cannot be undone.`}
        confirmLabel="Delete everything"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onResetAgent();
        }}
      />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          Transaction Log
        </h2>
        <div className="flex items-center gap-3">
          {allTransactions.length > 0 && (
            <button
              onClick={() =>
                downloadTransactionPDF(allTransactions, spending, { recipient })
              }
              className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all"
            >
              Download Report
            </button>
          )}
          {allTransactions.length > 0 && (
            <button
              onClick={() => {
                // CSV export: transactions with memo column
                const header =
                  "Time,Type,Description,Memo,Amount,Status,Stellar Tx\n";
                const rows = allTransactions
                  .map((tx) =>
                    [
                      new Date(tx.timestamp).toLocaleString(),
                      tx.type,
                      `"${tx.description.replace(/"/g, '""')}"`,
                      `"${(tx.memo ?? "").replace(/"/g, '""')}"`,
                      tx.amount.toFixed(2),
                      tx.status,
                      tx.stellarTxHash ?? "",
                    ].join(","),
                  )
                  .join("\n");
                const blob = new Blob([header + rows], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "careguard-transactions.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-100 active:bg-slate-200 cursor-pointer transition-all"
            >
              Export CSV
            </button>
          )}
          {auditEvents.length > 0 && (
            <button
              onClick={() => downloadAuditLogPDF(auditEvents, { recipient })}
              className="px-3 py-1.5 bg-violet-50 text-violet-700 rounded-lg text-xs font-medium hover:bg-violet-100 active:bg-violet-200 cursor-pointer transition-all"
            >
              Audit Report
            </button>
          )}
          <button
            onClick={() => setAgentLog([])}
            className="text-xs text-amber-500 hover:text-amber-700 hover:underline active:text-amber-800 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 rounded px-1"
          >
            Clear Log
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            className="text-xs text-red-500 hover:text-red-700 hover:underline active:text-red-800 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500 rounded px-1"
          >
            Reset All
          </button>
        </div>
      </div>
      <div
        className="bg-slate-900 rounded-xl p-4 font-mono text-xs text-green-400 max-h-48 overflow-y-auto"
        aria-live="polite"
      >
        <div aria-hidden="true">
          {agentLog.length === 0 ? (
            <span className="text-slate-500">No agent activity yet...</span>
          ) : (
            <>
              {!showAllLogEntries && agentLog.length > 50 && (
                <div className="text-slate-400 mb-2">
                  Showing last 50 of {agentLog.length} entries.{" "}
                  <button
                    onClick={() => setShowAllLogEntries(true)}
                    className="text-sky-400 hover:text-sky-300 underline"
                  >
                    Show all
                  </button>
                </div>
              )}
              {(showAllLogEntries ? agentLog : agentLog.slice(-50)).map(
                (entry) => (
                  <div key={entry.id}>
                    {entry.errorDetail ? (
                      <details className="group">
                        <summary className="cursor-pointer list-none flex items-center gap-1 hover:text-green-300">
                          <span className="text-xs opacity-60 group-open:opacity-100">
                            ▸
                          </span>
                          {entry.message}
                        </summary>
                        <div className="ml-4 mt-1 space-y-1">
                          <pre className="text-xs text-red-400 whitespace-pre-wrap break-all bg-slate-800 p-2 rounded">
                            {entry.errorDetail}
                          </pre>
                          <button
                            onClick={async () => {
                              if (!entry.errorDetail) return;
                              const result = await copyText(entry.errorDetail);
                              if (result === "ok" || result === "fallback") {
                                const btn =
                                  document.activeElement as HTMLElement;
                                const orig = btn?.textContent;
                                if (btn) {
                                  btn.textContent = "Copied!";
                                  setTimeout(() => {
                                    btn.textContent = orig;
                                  }, 1500);
                                }
                              }
                            }}
                            className="text-[10px] text-sky-400 hover:text-sky-300 underline"
                          >
                            Copy error
                          </button>
                        </div>
                      </details>
                    ) : (
                      entry.message
                    )}
                  </div>
                ),
              )}
              {showAllLogEntries && agentLog.length > 50 && (
                <div className="text-slate-400 mt-2">
                  <button
                    onClick={() => setShowAllLogEntries(false)}
                    className="text-sky-400 hover:text-sky-300 underline"
                  >
                    Show last 50
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="sr-only">
          {agentLog
            .slice(-20)
            .map((entry) => entry.message)
            .join("\n")}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {mergedTimeline.length === 0 && !pagination ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No activity yet
          </div>
        ) : (
          <>
            {pagination && (
              <div className="border-b border-slate-200 px-4 py-3 bg-slate-50">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    Showing{" "}
                    {Math.min(
                      pagination.limit,
                      pagination.total - pagination.offset,
                    )}{" "}
                    of {pagination.total} transactions
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(0);
                      }}
                      className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                    >
                      <option value={10}>10/page</option>
                      <option value={25}>25/page</option>
                      <option value={50}>50/page</option>
                      <option value={100}>100/page</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          setCurrentPage(Math.max(0, currentPage - 1))
                        }
                        disabled={!pagination.hasPrevious}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                      >
                        Previous
                      </button>
                      <span className="px-2 py-1 text-xs text-slate-600">
                        Page {currentPage + 1} of{" "}
                        {Math.ceil(pagination.total / pagination.limit)}
                      </span>
                      <button
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={!pagination.hasMore}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="overflow-x-auto shadow-[inset_-10px_0_12px_-12px_rgba(15,23,42,0.25)]">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="hidden md:table-cell text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Time
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Type
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Description
                    </th>
                    <th className="hidden lg:table-cell text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Memo
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">
                      Amount
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">
                      Status
                    </th>
                    <th className="hidden sm:table-cell text-right px-4 py-2 text-xs font-medium text-slate-500">
                      Order
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">
                      Stellar Tx
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mergedTimeline.map((item) => {
                    if (item.kind === "audit") {
                      const au = item.data as AuditLogEvent;
                      return (
                        <tr
                          key={item.id}
                          className="border-b border-slate-100 last:border-0 bg-slate-50/50"
                        >
                          <td className="hidden md:table-cell px-4 py-2 text-xs text-slate-400">
                            {formatTime(new Date(au.timestamp), locale)}
                          </td>
                          <td className="px-4 py-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-200">
                              audit
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs">
                            <span className="font-semibold text-slate-700">
                              {au.event}
                            </span>
                            {au.details?.tool && (
                              <span className="text-slate-500 ml-1">
                                — Tool: {au.details.tool}
                              </span>
                            )}
                          </td>
                          {/* memo column — empty for audit rows */}
                          <td className="hidden lg:table-cell px-4 py-2 text-xs text-slate-400">
                            -
                          </td>
                          <td className="px-4 py-2 text-right text-xs font-mono text-slate-400">
                            -
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-slate-500">
                            {au.actor}
                          </td>
                          {/* order status column — empty for audit rows */}
                          <td className="hidden sm:table-cell px-4 py-2 text-right text-xs text-slate-400">
                            -
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-slate-400">
                            -
                          </td>
                        </tr>
                      );
                    }
                    const tx = item.data as Transaction;
                    return (
                      <tr
                        key={tx.id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="hidden md:table-cell px-4 py-2 text-xs text-slate-400">
                          {formatTime(new Date(tx.timestamp), locale)}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              tx.type === "medication"
                                ? "bg-blue-100 text-blue-700"
                                : tx.type === "bill"
                                  ? "bg-purple-100 text-purple-700"
                                  : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs">{tx.description}</td>
                        {/* Memo — only shown on large screens; empty dash if not set */}
                        <td className="hidden lg:table-cell px-4 py-2 text-xs text-slate-500 italic">
                          {tx.memo ?? "-"}
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-mono">
                          $
                          {tx.amount < 0.01
                            ? tx.amount.toFixed(4)
                            : tx.amount.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              tx.status === "completed"
                                ? "bg-green-100 text-green-700"
                                : tx.status === "blocked"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {tx.status}
                          </span>
                        </td>
                        {/* Order status badge — only for medication transactions */}
                        <td className="hidden sm:table-cell px-4 py-2 text-right">
                          {tx.type === "medication" && tx.order_status ? (
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                tx.order_status === "picked_up"
                                  ? "bg-green-100 text-green-700"
                                  : tx.order_status === "ready"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {tx.order_status === "picked_up"
                                ? "Picked up"
                                : tx.order_status === "ready"
                                  ? "Ready"
                                  : "Submitted"}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <TxLink
                            hash={tx.stellarTxHash}
                            txHashStatus={tx.txHashStatus}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
