import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  it("forwards its ref to the rendered input element", () => {
    const ref = React.createRef<HTMLInputElement>();

    render(<Input ref={ref} aria-label="Email address" />);

    expect(ref.current).toBe(screen.getByRole("textbox", { name: "Email address" }));
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it.each(["email", "number"] as const)("applies type=%s to the input", type => {
    render(<Input type={type} aria-label="Field" />);

    expect(screen.getByLabelText("Field")).toHaveAttribute("type", type);
  });

  it("applies the disabled attribute and disabled utility classes", () => {
    render(<Input disabled aria-label="Disabled field" />);

    const input = screen.getByRole("textbox", { name: "Disabled field" });

    expect(input).toBeDisabled();
    expect(input).toHaveClass("disabled:cursor-not-allowed");
    expect(input).toHaveClass("disabled:opacity-50");
  });

  it("passes arbitrary accessibility and placeholder props through unchanged", () => {
    render(
      <Input
        aria-label="Email address"
        aria-invalid="true"
        aria-describedby="email-error"
        placeholder="name@example.com"
      />
    );

    const input = screen.getByRole("textbox", { name: "Email address" });

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
    expect(input).toHaveAttribute("placeholder", "name@example.com");
  });
});
