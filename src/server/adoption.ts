import{rebuildCumulativeDefects,rebuildMappedMetrics}from'@/server/cumulative-defects';
/** Compatibility entry point: replay the established cumulative register, then recalculate mapped A metrics. */
export async function recalculateAdoption(cycleId:string,counsellorIds:string[]){for(const id of [...new Set(counsellorIds)])await rebuildCumulativeDefects(cycleId,id);await rebuildMappedMetrics(cycleId,counsellorIds);}
