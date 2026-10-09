import { createFileRoute } from "@tanstack/react-router";

import { BoardPage } from "../components/Board";

export const Route = createFileRoute("/board")({
  component: BoardPage,
});
