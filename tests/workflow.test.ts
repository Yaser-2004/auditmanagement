import{describe,it,expect}from'vitest';import{validateStageTiming}from'../src/domain/workflow';
const d=(day:number)=>new Date(Date.UTC(2026,9,day,10));
describe('six-stage audit workflow',()=>{
 it('requires the previous audit stage for each quality checkpoint',()=>{expect(validateStageTiming('Q1',d(13),null)).toContain('Import T1');expect(validateStageTiming('Q2',d(15),null)).toContain('Import Q1');expect(validateStageTiming('T2',d(19),null)).toContain('Import Q2');expect(validateStageTiming('Q3',d(20),null)).toContain('Import T2');expect(validateStageTiming('Q4',d(22),null)).toContain('Import Q3');});
 it('enforces the configured minimum gaps and accepts the demo cadence',()=>{expect(validateStageTiming('Q1',d(13),d(12))).toBeNull();expect(validateStageTiming('Q1',d(12),d(12))).toContain('at least 1 day');expect(validateStageTiming('Q2',d(15),d(13))).toBeNull();expect(validateStageTiming('Q2',d(14),d(13))).toContain('at least 2 days');expect(validateStageTiming('Q3',d(20),d(19))).toBeNull();expect(validateStageTiming('Q4',d(22),d(20))).toBeNull();});
});
