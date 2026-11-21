import{describe,it,expect}from'vitest';
import{calculateCheckpointMetric,calculatePerformanceSummary,PROPOSED_ADOPTION_CHECKPOINTS}from'../src/domain/metrics';

describe('configured cumulative adoption metrics',()=>{
 it('proposes Q1 through Q4 as the configurable metric checkpoints',()=>{expect(PROPOSED_ADOPTION_CHECKPOINTS).toEqual({A1:'Q1',A2:'Q2',A3:'Q3',A4:'Q4'});});
 it('uses the snapshot numerator and denominator at a reached checkpoint',()=>{expect(calculateCheckpointMetric('Q1',{numerator:1,denominator:2})).toMatchObject({checkpoint:'Q1',numerator:1,denominator:2,percentage:50,status:'CALCULATED'});});
 it('represents an unreached checkpoint and zero-defect checkpoint explicitly',()=>{expect(calculateCheckpointMetric('Q4',null)).toMatchObject({checkpoint:'Q4',numerator:null,denominator:null,percentage:null,status:'CHECKPOINT_NOT_REACHED'});expect(calculateCheckpointMetric('Q1',{numerator:0,denominator:0})).toMatchObject({numerator:0,denominator:0,percentage:null,status:'NO_DEFECTS'});});
 it('does not calculate averages or delta when one metric is unavailable',()=>{const a=calculateCheckpointMetric('Q1',{numerator:1,denominator:2}),pending=calculateCheckpointMetric('Q2',null);const summary=calculatePerformanceSummary({A1:a,A2:pending,A3:a,A4:a});expect(summary).toMatchObject({avg1:null,avg2:50,delta:null});});
 it('calculates Avg1, Avg2 and Delta from the four configured metrics',()=>{const m=(n:number,d:number)=>calculateCheckpointMetric('Q1',{numerator:n,denominator:d});expect(calculatePerformanceSummary({A1:m(0,2),A2:m(1,2),A3:m(0,2),A4:m(1,2)})).toMatchObject({avg1:25,avg2:25,delta:0,status:'CALCULATED'});expect(calculatePerformanceSummary({A1:m(0,2),A2:m(1,2),A3:m(1,2),A4:m(2,2)})).toMatchObject({avg1:25,avg2:75,delta:50,direction:'positive'});});
});
