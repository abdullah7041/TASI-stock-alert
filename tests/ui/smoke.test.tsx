import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("the DOM runner renders and queries real elements", () => {
  render(<button type="button">Ping</button>);
  expect(screen.getByRole("button", { name: "Ping" })).toBeTruthy();
});
