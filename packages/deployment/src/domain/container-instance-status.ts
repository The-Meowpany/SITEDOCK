import { StateMachine } from "@sitedock/shared";

export type ContainerInstanceStatus = "RUNNING" | "STOPPED" | "FAILED";

export const containerInstanceStateMachine = new StateMachine<ContainerInstanceStatus>("ContainerInstance", {
  RUNNING: ["STOPPED", "FAILED"],
  STOPPED: ["RUNNING"],
  FAILED: [],
});
