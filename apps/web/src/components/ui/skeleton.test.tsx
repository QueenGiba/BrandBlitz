import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton, TableSkeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders one shimmer div and merges a custom className", () => {
    const { container } = render(<Skeleton className="custom-skeleton" data-testid="skeleton" />);

    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toHaveClass("skeleton-shimmer", "custom-skeleton");
  });
});

describe("TableSkeleton", () => {
  it("renders five row groups and four header placeholders by default", () => {
    const { container } = render(<TableSkeleton />);

    const groups = Array.from(container.firstElementChild!.children);
    const header = groups[0];

    expect(groups).toHaveLength(6);
    expect(header.querySelectorAll(".skeleton-shimmer")).toHaveLength(4);
    expect(groups.slice(1)).toHaveLength(5);
  });

  it("respects custom row and column counts", () => {
    const { container } = render(<TableSkeleton rows={3} cols={2} />);

    const groups = Array.from(container.firstElementChild!.children);
    const header = groups[0];
    const rows = groups.slice(1);

    expect(rows).toHaveLength(3);
    expect(header.querySelectorAll(".skeleton-shimmer")).toHaveLength(2);
    rows.forEach(row => {
      expect(row.querySelectorAll(".skeleton-shimmer")).toHaveLength(2);
    });
  });

  it("uses the wider class for column one and the compact class for other columns", () => {
    const { container } = render(<TableSkeleton rows={2} cols={3} />);

    const rows = Array.from(container.firstElementChild!.children).slice(1);

    rows.forEach(row => {
      const cells = Array.from(row.querySelectorAll(".skeleton-shimmer"));

      expect(cells[0]).toHaveClass("ml-auto", "w-16");
      expect(cells[1]).toHaveClass("w-36");
      expect(cells[1]).not.toHaveClass("ml-auto", "w-16");
      expect(cells[2]).toHaveClass("ml-auto", "w-16");
    });
  });
});
