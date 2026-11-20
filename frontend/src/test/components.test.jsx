import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResolveExceptionModal from "../components/ResolveExceptionModal.jsx";
import { formatMoney, formatSlaCountdown } from "../utils/formatters.js";

// Mock API client
vi.mock("../api/client.js", () => ({
  api: {
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
