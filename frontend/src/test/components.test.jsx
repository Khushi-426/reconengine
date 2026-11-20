import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ResolveExceptionModal from "../components/ResolveExceptionModal.jsx";
import InvestigationPanel from "../components/InvestigationPanel.jsx";
import { formatMoney, formatSlaCountdown } from "../utils/formatters.js";

// Mock API client
vi.mock("../api/client.js", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

describe("ResolveExceptionModal", () => {
  const dummyException = {
    exception_id: 101,
    exception_type: "AMOUNT_MISMATCH",
    version: 1,
    ledger_amount: "100.50",
    external_amount: "100.00",
    ledger_ref: "LDG-101",
    external_ref: "EXT-101",
  };

  it("validates resolution note minimum length of 5 characters", async () => {
    render(
      <ResolveExceptionModal
        exception={dummyException}
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />
    );

    const submitBtn = screen.getByRole("button", { name: /resolve exception/i });
    expect(submitBtn).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/verified transaction/i);
    fireEvent.change(textarea, { target: { value: "fee" } }); // 3 chars
    expect(submitBtn).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "Valid audit resolution note" } }); // >= 5 chars
    expect(submitBtn).not.toBeDisabled();
  });

  it("requires confirmation step before final submission", async () => {
    render(
      <ResolveExceptionModal
        exception={dummyException}
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText(/verified transaction/i);
    fireEvent.change(textarea, { target: { value: "Manual confirmation of FX difference" } });

    const submitBtn = screen.getByRole("button", { name: /resolve exception/i });
    fireEvent.click(submitBtn);

    // Confirmation button appears
    const confirmBtn = screen.getByRole("button", { name: /confirm resolution/i });
    expect(confirmBtn).toBeInTheDocument();
    expect(screen.getByText(/are you sure you want to mark exception/i)).toBeInTheDocument();
  });
});

describe("formatters", () => {
  it("formats monetary values safely with symbol", () => {
    expect(formatMoney("1250.50", "GBP")).toBe("£1,250.50");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(0)).toBe("£0.00");
  });

  it("formats SLA countdowns and breach states accurately", () => {
    expect(formatSlaCountdown(3660)).toBe("1h 1m left");
    expect(formatSlaCountdown(-1800)).toBe("Breached (+0h 30m)");
    expect(formatSlaCountdown(null)).toBe("—");
  });
});

describe("InvestigationPanel", () => {
  const investigation = {
    investigation_id: "10",
    status: "COMPLETED",
    stages: [],
    result: {
      discrepancyCategory: "AMOUNT_MISMATCH",
      verification: { status: "VERIFIED_WITH_DISCLOSED_LIMITATIONS" },
      analysis: { calculations: { amountDifference: "0.50", currency: "GBP", dateDifferenceDays: 0 } },
      evidence: { evidenceIds: ["EXCEPTION_101", "LEDGER_101"], missingEvidence: [] },
      investigation: {
        hypotheses: [{ cause: "AMOUNT_DISCREPANCY", explanation: "Variance observed between ledger and bank feed.", supportingEvidence: ["EXCEPTION_101"], rule: "AMOUNT_TOLERANCE_EXCEEDED", confirmed: false }],
        nextSteps: ["Request bank tariff sheet for fee verification"],
      },
      report: { title: "Investigation report", evidence: ["EXCEPTION_101", "LEDGER_101"] },
    },
  };

  it("queues and displays the deterministic investigation report", async () => {
    const { api } = await import("../api/client.js");
    api.post.mockResolvedValueOnce({ investigationId: "10" });
    api.get.mockResolvedValueOnce(investigation);

    render(<InvestigationPanel exceptionId={101} />);
    expect(screen.getByText(/Rule-based analysis from source records/i)).toBeInTheDocument();
    const investigateBtn = screen.getByRole("button", { name: /investigate/i });
    fireEvent.click(investigateBtn);

    await waitFor(() => {
      expect(screen.getByText(/Variance observed between ledger and bank feed./i)).toBeInTheDocument();
      expect(screen.getByText(/EXCEPTION_101/i)).toBeInTheDocument();
      expect(screen.getByText(/Request bank tariff sheet for fee verification/i)).toBeInTheDocument();
      expect(screen.getByText(/Possible/i)).toBeInTheDocument();
    });
  });

  it("allows submitting user feedback on the investigation", async () => {
    const { api } = await import("../api/client.js");
    api.post.mockResolvedValueOnce({ investigationId: "10" });
    api.post.mockResolvedValueOnce({ feedback_id: 1 });
    api.get.mockResolvedValueOnce(investigation);

    render(<InvestigationPanel exceptionId={101} />);
    fireEvent.click(screen.getByRole("button", { name: /investigate/i }));

    await waitFor(() => {
      expect(screen.getByText(/Was this useful/i)).toBeInTheDocument();
    });

    const thumbsUpBtn = screen.getByRole("button", { name: /Yes/i });
    fireEvent.click(thumbsUpBtn);

    await waitFor(() => {
      expect(screen.getByText(/Feedback recorded/i)).toBeInTheDocument();
    });
  });
});
