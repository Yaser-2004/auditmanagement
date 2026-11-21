export type Priority='HIGH'|'LOW';
export const PARAMETERS=[
['1A','Greetings and self introduction','1','LOW'],['1B','Affection / welcoming speech','1','LOW'],['1C','RPC confirmation','1','LOW'],['1D','Purpose linked with enquiry','2','HIGH'],['1E','Interest, FOMO and batch check','1','HIGH'],
['2A','Qualification / eligibility check','2','HIGH'],['2B','Learner evaluation','2','HIGH'],['2C','Experience evaluation','4','HIGH'],['2D','Decision-maker profile check','1','HIGH'],['2E','Required program','1','HIGH'],['2F','Required specialization','1','HIGH'],
['3A','Candidate career goals','5','HIGH'],['3B','Online vs offline','2','LOW'],['3C','Source of income / payment mode','1','LOW'],['3D','Pain area identification','4','HIGH'],['3E','Program planning duration','2','LOW'],['3F','Other university enquiries','2','HIGH'],
['4A','University information and USPs','4','HIGH'],['4B','Accreditations and approvals','2','HIGH'],['4C','Program structure and curriculum','4','HIGH'],['4D','Classes and examination process','4','HIGH'],['4E','Domain and specialization mapping','6','HIGH'],['4F','Outcome orientation','4','HIGH'],
['5A','Fee structure and payment mode','4','HIGH'],['5B','Preferred payment mode judgement','1','HIGH'],['5C','Scholarships and discount','2','LOW'],['5D','Objection handling','6','HIGH'],['5E','Website navigation and admission','2','HIGH'],
['6A','On-spot close attempt','2','HIGH'],['6B','Close after budget analysis','2','HIGH'],['6C','Close after need analysis','2','HIGH'],['6D','Close after program mapping','3','HIGH'],['6E','Urgency creation','5','HIGH'],['6F','Reference request','5','HIGH'],
['7A','Counsellor leads 80% of call','2','HIGH'],['7B','Two-way interaction','2','LOW'],['7C','Voice modulation','2','LOW'],['7D','ROS maintained','1','LOW'],['7E','Active listening','1','LOW'],['7F','Confidence','1','HIGH'],
['8A','Ownership failure','0','HIGH'],['8B','Unprofessional behaviour','0','HIGH'],['8C','Misleading information','0','HIGH'],['8D','Call avoidance / dead air','0','HIGH'],
['9A','Involved in financial transaction','0','HIGH'],['9B','Personal information / privacy breach','0','HIGH'],['9C','Rude or abusive language','0','HIGH'],
] as const;
export const STAGES=['T1','Q1','Q2','T2','Q3','Q4'] as const;
export type Stage=typeof STAGES[number];
export type Status='PASS'|'PARTIAL'|'FAIL'|'NA';
