import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewSheet } from "@/components/demo/ReviewSheet";

const recipient = { name: "TEST PAYEE", bank: "Test Bank", bankCode: "000", accountNumber: "0123456789", known: false };

function sheet(onClose = vi.fn(), onConfirm = vi.fn()) {
  render(
    <ReviewSheet open onClose={onClose} onConfirm={onConfirm} from="Test Customer" to={recipient} amount={500_000}
      available={2_000_000} narration="rent" channel="Mobile App" />,
  );
  return { onClose, onConfirm };
}

describe("ReviewSheet", () => {
  it("shows what is about to be sent, and the warning", () => {
    sheet();
    expect(screen.getByRole("dialog", { name: "Check before you send" })).toBeTruthy();
    expect(screen.getByText("₦500,000")).toBeTruthy();
    expect(screen.getByText("Hundreds of thousands")).toBeTruthy();
    expect(screen.getByText("TEST PAYEE")).toBeTruthy();
    expect(screen.getByText("₦1,500,000")).toBeTruthy(); // balance after
    expect(screen.getByText(/can't be reversed/)).toBeTruthy();
  });

  it("sends only on Confirm; Recheck closes", () => {
    const { onClose, onConfirm } = sheet();
    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("renders nothing without a recipient", () => {
    const { container } = render(
      <ReviewSheet open onClose={vi.fn()} onConfirm={vi.fn()} from="x" to={null} amount={1} available={null}
        narration="" channel="Web" />,
    );
    expect(container.innerHTML).toBe("");
  });
});
