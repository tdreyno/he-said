import { Task } from "./task"

export const interpret = async (task: Task<boolean>): Promise<boolean> => {
  return task.run()
}
