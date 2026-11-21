import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders its title and omits the description when none is provided", () => {
    const { container } = render(<EmptyState title="No brands yet" />);

    expect(screen.getByRole("heading", { name: "No brands yet" })).toBeInTheDocument();
    expect(container.querySelector("p")).not.toBeInTheDocument();
  });

  it("uses a custom icon instead of the default sparkle icon", () => {
    render(<EmptyState title="Nothing here" icon={<span data-testid="custom-icon">Custom icon</span>} />);

    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
    expect(screen.queryByText("✨")).not.toBeInTheDocument();
  });

  it("renders the action inside its wrapper only when an action is provided", () => {
    const { container, rerender } = render(<EmptyState title="No results" />);

    expect(container.querySelector(".mt-6.flex.justify-center")).not.toBeInTheDocument();

    rerender(
      <EmptyState title="No results" action={<button type="button">Create one</button>} />
    );

    const action = screen.getByRole("button", { name: "Create one" });
    expect(action.parentElement).toHaveClass("mt-6", "flex", "justify-center");
  });

  it("merges a custom className onto the outer Card element", () => {
    const { container } = render(<EmptyState title="No results" className="custom-empty-state" />);

    expect(container.firstElementChild).toHaveClass("custom-empty-state", "text-center");
  });
});
