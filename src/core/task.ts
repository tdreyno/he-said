import { MaybePromise } from "./types"

export interface Task<T> {
  run: () => Promise<T>
}

export const from = <T>(fn: () => MaybePromise<T>): Task<T> => ({
  run: () => Promise.resolve().then(fn),
})

export const andTask = (tasks: Array<Task<boolean>>): Task<boolean> =>
  from(async () => {
    const results = await Promise.all(tasks.map(task => task.run()))
    return results.every(Boolean)
  })

export const orTask = (tasks: Array<Task<boolean>>): Task<boolean> =>
  from(async () => {
    const results = await Promise.all(tasks.map(task => task.run()))
    return results.some(Boolean)
  })

export const notTask = (task: Task<boolean>): Task<boolean> =>
  from(async () => {
    return !(await task.run())
  })
