import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "./progress";

describe("Progress", () => {
  it("translates the indicator fully off-screen when value is zero", () => {
    render(<Progress value={0} aria-label="Upload progress" />);

    const indicator = screen.getByRole("progressbar").querySelector("[data-radix-progress-indicator]");

    expect(indicator).toHaveStyle({ transform: "translateX(-100%)" });
  });

  it("does not translate the indicator when value is one hundred", () => {
    render(<Progress value={100} aria-label="Upload progress" />);

    const indicator = screen.getByRole("progressbar").querySelector("[data-radix-progress-indicator]");

    expect(indicator).toHaveStyle({ transform: "translateX(-0%)" });
  });

  it("treats an undefined value as zero for the indicator transform", () => {
    render(<Progress aria-label="Upload progress" />);

    const indicator = screen.getByRole("progressbar").querySelector("[data-radix-progress-indicator]");

    expect(indicator).toHaveStyle({ transform: "translateX(-100%)" });
  });

  it("forwards its ref to the Radix progress root", () => {
    const ref = React.createRef<HTMLDivElement>();

    render(<Progress ref={ref} value={40} aria-label="Upload progress" />);

    expect(ref.current).toBe(screen.getByRole("progressbar"));
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
