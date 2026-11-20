import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ResolveExceptionModal from "../components/ResolveExceptionModal.jsx";
import AiInvestigationPanel from "../components/AiInvestigationPanel.jsx";
import { formatMoney, formatSlaCountdown } from "../utils/formatters.js";

// Mock API client
vi.mock("../api/client.js", () => ({
  api: {
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

describe("AiInvestigationPanel", () => {
  const mockApiResponse = {
    data: {
      investigationId: 10,
      exceptionId: 101,
      status: "SUCCESS_MODEL",
      deterministicHints: {
        category: "AMOUNT_MISMATCH",
        amountDiffFormatted: "0.50",
        dateDiffDays: 0,
      },
      aiAnalysis: {
        summary: "Variance observed between ledger and bank feed.",
        suspected_category: "AMOUNT_MISMATCH",
        possible_explanations: [
          {
            hypothesis: "Minor bank clearing transaction surcharge applied.",
            supporting_evidence_ids: ["EXCEPTION_101", "LEDGER_101"],
            confidence: "HIGH",
          },
        ],
        recommended_next_checks: ["Request bank tariff sheet for fee verification"],
        uncertainty: "Low uncertainty",
        missing_evidence: [],
      },
    },
  };

  it("renders AI disclaimer and runs investigation on demand", async () => {
    const { api } = await import("../api/client.js");
    api.post.mockResolvedValueOnce(mockApiResponse);

    render(<AiInvestigationPanel exceptionId={101} />);

    // Safety disclaimer must be displayed immediately
    expect(screen.getByText(/AI-generated suggestion. Requires analyst judgment./i)).toBeInTheDocument();

    const investigateBtn = screen.getByRole("button", { name: /investigate break/i });
    fireEvent.click(investigateBtn);

    await waitFor(() => {
      expect(screen.getByText(/Minor bank clearing transaction surcharge applied./i)).toBeInTheDocument();
      expect(screen.getByText(/EXCEPTION_101/i)).toBeInTheDocument();
      expect(screen.getByText(/Request bank tariff sheet for fee verification/i)).toBeInTheDocument();
      expect(screen.getByText(/HIGH CONFIDENCE/i)).toBeInTheDocument();
    });
  });

  it("allows submitting user feedback on the investigation", async () => {
    const { api } = await import("../api/client.js");
    api.post.mockResolvedValueOnce(mockApiResponse);
    api.post.mockResolvedValueOnce({ data: { feedback_id: 1 } });

    render(<AiInvestigationPanel exceptionId={101} />);
    fireEvent.click(screen.getByRole("button", { name: /investigate break/i }));

    await waitFor(() => {
      expect(screen.getByText(/Was this investigation analysis helpful/i)).toBeInTheDocument();
    });

    const thumbsUpBtn = screen.getByRole("button", { name: /👍 Yes/i });
    fireEvent.click(thumbsUpBtn);

    await waitFor(() => {
      expect(screen.getByText(/Your investigation feedback has been recorded/i)).toBeInTheDocument();
    });
  });
});
