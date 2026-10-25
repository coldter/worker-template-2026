import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createContext, useContext, useMemo } from "react";
import { fn } from "storybook/test";

import AppError from "./app-error";

const noop = fn();

const StoryErrorContext = createContext<Error | null>(null);

const StoryRoot = () => {
  const error = useContext(StoryErrorContext);

  if (!error) {
    return <Outlet />;
  }

  return (
    <>
      <Outlet />
      <AppError error={error} info={{ componentStack: "" }} reset={noop} />
    </>
  );
};

const StoryRouter = ({ error }: { error: Error }) => {
  const router = useMemo(() => {
    const storyRoute = createRootRoute({ component: StoryRoot });

    return createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: storyRoute,
    });
  }, []);

  return (
    <StoryErrorContext value={error}>
      <RouterProvider router={router} />
    </StoryErrorContext>
  );
};

const meta = {
  args: {
    error: new Error("Placeholder"),
    info: { componentStack: "" },
    reset: noop,
  },
  component: AppError,
  parameters: {
    docs: {
      description: {
        component:
          "Top-level error boundary UI. Shows a user-facing message, a stack trace in non-dev builds, and actions to retry or return home.",
      },
    },
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  title: "Common/AppError",
} satisfies Meta<typeof AppError>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <StoryRouter error={new Error("Failed to fetch user profile")} />
  ),
};

export const WithStack: Story = {
  render: () => {
    const err = new Error("Unexpected token in JSON at position 42");
    err.stack =
      "Error: Unexpected token in JSON at position 42\n    at parseResponse (api.ts:112:9)\n    at fetchUser (api.ts:48:22)";

    return <StoryRouter error={err} />;
  },
};
