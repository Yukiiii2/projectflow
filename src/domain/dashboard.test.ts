import { describe, expect, it } from 'vitest'
import {
  dashboardPeriods,
  getCompletionSeries,
  getDashboardSnapshot,
  getWorkspace,
} from './dashboard'

describe('ProjectFlow dashboard data', () => {
  it('keeps Northstar Studio metrics consistent with its project totals', () => {
    const workspace = getWorkspace('northstar')
    const projectTaskTotal = workspace.projects.reduce((sum, project) => sum + project.taskTotal, 0)
    const completedProjectTasks = workspace.projects.reduce(
      (sum, project) => sum + project.completedTasks,
      0,
    )
    const snapshot = getDashboardSnapshot(workspace)

    expect(projectTaskTotal).toBe(128)
    expect(completedProjectTasks).toBe(96)
    expect(snapshot).toEqual({
      activeProjects: 4,
      completedTasks: 96,
      totalTasks: 128,
      dueThisWeek: 8,
      overdueTasks: 3,
      completionRate: 75,
    })
  })

  it('provides period-specific completion series ending at the current completion rate', () => {
    const workspace = getWorkspace('northstar')
    const series = dashboardPeriods.map((period) => getCompletionSeries(workspace, period.id))

    expect(series.map((entry) => entry.values.at(-1))).toEqual([75, 75, 75])
    expect(new Set(series.map((entry) => entry.values.join(','))).size).toBe(3)
  })

  it('updates the completed total for local task previews without exceeding the total', () => {
    const workspace = getWorkspace('northstar')

    expect(getDashboardSnapshot(workspace, 1).completedTasks).toBe(97)
    expect(getDashboardSnapshot(workspace, 999).completedTasks).toBe(128)
  })
})
